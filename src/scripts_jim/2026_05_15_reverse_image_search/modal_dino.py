"""Modal service hosting a DINO image-embedding endpoint.

Loads DINOv3 (falls back to DINOv2 if v3 weights are not accessible — v3 is
gated on Hugging Face and requires accepting the license). The CLS-token
embedding is L2-normalized so cosine similarity is just a dot product on the
client side.

Deploy:
    modal deploy src/scripts_jim/2026_05_15_reverse_image_search/modal_dino.py

After deploy, the FastAPI web endpoints are reachable at the URL printed by
`modal deploy` (one URL per `@modal.fastapi_endpoint`). The same functions are
also callable from inside Modal via `Embedder().embed.remote(...)`.
"""

from __future__ import annotations

import base64
import io

import modal

APP_NAME = "dino-embed"
# DINOv3 ViT-B is gated; we try it first and fall back to v2 if loading fails.
DINO_V3_MODEL = "facebook/dinov3-vitb16-pretrain-lvd1689m"
DINO_V2_MODEL = "facebook/dinov2-base"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
        "transformers==4.46.3",
        "pillow==10.4.0",
        "numpy<2",
        "requests==2.32.3",
        "fastapi[standard]",
    )
)

app = modal.App(APP_NAME, image=image)


@app.cls(gpu=None, scaledown_window=300, timeout=600, min_containers=0)
class Embedder:
    @modal.enter()
    def load(self) -> None:
        import os

        import torch
        from transformers import AutoImageProcessor, AutoModel

        self.torch = torch
        # Prefer DINOv3; fall back to DINOv2 if the gated weights aren't available.
        token = os.environ.get("HUGGINGFACE_TOKEN") or os.environ.get("HF_TOKEN")
        loaded = None
        for name in (DINO_V3_MODEL, DINO_V2_MODEL):
            try:
                processor = AutoImageProcessor.from_pretrained(name, token=token)
                model = AutoModel.from_pretrained(name, token=token).eval()
                loaded = (name, processor, model)
                break
            except Exception as exc:  # pylint: disable=broad-except
                print(f"[modal_dino] failed to load {name}: {exc}")
        if not loaded:
            raise RuntimeError("Could not load any DINO model")
        self.model_name, self.processor, self.model = loaded
        print(f"[modal_dino] loaded {self.model_name}")

    def _embed_bytes(self, image_bytes: bytes) -> list[float]:
        import numpy as np
        from PIL import Image

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        inputs = self.processor(images=img, return_tensors="pt")
        with self.torch.no_grad():
            outputs = self.model(**inputs)
        # CLS token (index 0) — whole-image representation.
        emb = outputs.last_hidden_state[:, 0].cpu().numpy()[0]
        norm = float(np.linalg.norm(emb))
        if norm > 0:
            emb = emb / norm
        return emb.astype(float).tolist()

    def _fetch_url(self, url: str) -> bytes:
        import requests

        resp = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        return resp.content

    @modal.method()
    def embed_url(self, url: str) -> dict:
        try:
            return {"embedding": self._embed_bytes(self._fetch_url(url)), "model": self.model_name}
        except Exception as exc:  # pylint: disable=broad-except
            return {"error": str(exc), "model": self.model_name}

    @modal.method()
    def embed_b64(self, image_b64: str) -> dict:
        try:
            return {"embedding": self._embed_bytes(base64.b64decode(image_b64)), "model": self.model_name}
        except Exception as exc:  # pylint: disable=broad-except
            return {"error": str(exc), "model": self.model_name}

    @modal.method()
    def embed_many(self, urls: list[str]) -> list[dict]:
        return [self.embed_url.local(u) for u in urls]

    @modal.fastapi_endpoint(method="POST")
    def web_embed(self, data: dict) -> dict:
        """POST {"image_url": "..."} or {"image_b64": "..."} → {"embedding": [...], "model": "..."}"""
        if "image_url" in data:
            return self.embed_url.local(data["image_url"])
        if "image_b64" in data:
            return self.embed_b64.local(data["image_b64"])
        return {"error": "provide image_url or image_b64"}

    @modal.fastapi_endpoint(method="POST")
    def web_embed_many(self, data: dict) -> dict:
        """POST {"urls": [...]} → {"results": [{"embedding": [...], "model": "..."}, ...]}"""
        urls = data.get("urls") or []
        return {"results": [self.embed_url.local(u) for u in urls]}


@app.local_entrypoint()
def smoke(url: str = "https://pbs.twimg.com/media/HIR6DJ0W4AACPXK.jpg") -> None:
    """Quick sanity check: `modal run modal_dino.py --url <image_url>`."""
    embedder = Embedder()
    out = embedder.embed_url.remote(url)
    if "error" in out:
        print(f"ERROR: {out['error']}")
    else:
        emb = out["embedding"]
        print(f"model={out['model']} dim={len(emb)} first5={emb[:5]}")
