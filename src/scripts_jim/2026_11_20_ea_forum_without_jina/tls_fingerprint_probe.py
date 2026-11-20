"""Which part of a browser's request does the EA Forum's bot check look at?
Every request here is a plain HTTP request, no browser. curl_cffi is libcurl
built to send the same TLS handshake and HTTP/2 settings as a real browser.

    uv run --with curl_cffi src/scripts_jim/2026_11_20_ea_forum_without_jina/tls_fingerprint_probe.py [--box]

--box sends every request out through the services box's address. It needs
`ssh -N -D 127.0.0.1:1081 root@<services box>` running.
"""
import sys
from curl_cffi import requests

BOX = {"https": "socks5h://127.0.0.1:1081"} if "--box" in sys.argv else None
QUERY = "https://forum.effectivealtruism.org/graphql?query=%7B%20posts(input%3A%7Bterms%3A%7Bview%3A%22new%22%2Climit%3A2%7D%7D)%7Bresults%7B_id%20title%7D%7D%7D"
POST = "https://forum.effectivealtruism.org/posts/x/y"
CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

def show(label, **kwargs):
    try:
        r = requests.get(kwargs.pop("url", QUERY), timeout=25, proxies=BOX, **kwargs)
        print(f"{label:55} {r.status_code} {len(r.content):>7}b mitigated={r.headers.get('x-vercel-mitigated')}")
    except Exception as e:
        print(f"{label:55} error {e!r:.100}")

show("chrome TLS + chrome headers", impersonate="chrome")
show("chrome TLS + chrome headers, again", impersonate="chrome")
show("chrome TLS, UA curl/8.5", impersonate="chrome", headers={"User-Agent": "curl/8.5.0"})
show("chrome TLS, UA python-requests", impersonate="chrome", headers={"User-Agent": "python-requests/2.31"})
show("chrome TLS, no default headers, only UA", impersonate="chrome", default_headers=False, headers={"User-Agent": CHROME_UA})
show("chrome TLS, no default headers, UA + Accept json", impersonate="chrome", default_headers=False, headers={"User-Agent": CHROME_UA, "Accept": "application/json, */*;q=0.8"})
show("chrome TLS, no headers at all", impersonate="chrome", default_headers=False)
show("plain libcurl TLS (no impersonation), chrome UA", headers={"User-Agent": CHROME_UA})
show("chrome TLS over HTTP/1.1", impersonate="chrome", http_version="v1")
show("firefox TLS", impersonate="firefox")
show("safari TLS", impersonate="safari")
show("chrome99 (old) TLS", impersonate="chrome99")
show("chrome TLS, a post page", impersonate="chrome", url="https://forum.effectivealtruism.org/posts/x/y")
