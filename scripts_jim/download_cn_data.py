"""Download fresh Community Notes public data dumps into cn_data/."""

import os
import io
import zipfile
from datetime import datetime, timedelta, timezone

import requests

CN_DATA_BASE_URL = "https://ton.twimg.com/birdwatch-public-data"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "cn_data")
MAX_DAYS_BACK = 7

FILE_TYPES = ["notes", "noteStatusHistory", "noteRatings"]
PARTITIONS = {
    "notes": ["notes-00000.tsv", "notes-00001.tsv"],
    "noteStatusHistory": ["noteStatusHistory-00000.tsv"],
    "noteRatings": [f"ratings-{i:05d}.tsv" for i in range(8)],
}


def download_and_extract(file_type: str, partition: str, date_str: str) -> bool:
    zip_name = partition.replace(".tsv", ".zip")
    url = f"{CN_DATA_BASE_URL}/{date_str}/{file_type}/{zip_name}"
    print(f"  Trying {url}...")

    resp = requests.get(url)
    if resp.status_code != 200:
        print(f"    HTTP {resp.status_code}, skipping")
        return False

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        zf.extractall(OUTPUT_DIR)

    out_path = os.path.join(OUTPUT_DIR, partition)
    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"    Extracted {partition} ({size_mb:.1f} MB)")
    return True


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    for file_type in FILE_TYPES:
        print(f"\nDownloading {file_type}...")
        downloaded = False

        for days_back in range(MAX_DAYS_BACK):
            date = datetime.now(timezone.utc) - timedelta(days=days_back)
            date_str = date.strftime("%Y/%m/%d")
            print(f" Trying date {date_str}...")

            all_ok = True
            for partition in PARTITIONS[file_type]:
                if not download_and_extract(file_type, partition, date_str):
                    all_ok = False
                    break

            if all_ok:
                print(f"  Got {file_type} from {date_str}")
                downloaded = True
                break

        if not downloaded:
            print(f"  FAILED to download {file_type} (tried {MAX_DAYS_BACK} days back)")

    print("\nDone.")


if __name__ == "__main__":
    main()
