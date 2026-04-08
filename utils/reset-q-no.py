import json
import re
from pathlib import Path

NUMERIC_IMAGE_RE = re.compile(r"^\d+\.png$", re.IGNORECASE)
PASSAGE_IMAGE_RE = re.compile(r"^p\d+\.png$", re.IGNORECASE)
PASSAGE_ID_RE = re.compile(r"^P\d+$", re.IGNORECASE)


def renumber_single_assignment(json_path: Path) -> None:
    # Remove existing backup if present
    backup_path = json_path.with_suffix(".json.bak")
    if backup_path.exists():
        backup_path.unlink()

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        print(f"Skipping {json_path}: root is not a list")
        return

    next_numeric = 1
    next_passage = 1

    passage_id_map = {}
    passage_image_map = {}

    for item in data:
        if not isinstance(item, dict):
            continue

        old_passage_id = item.get("passageId")
        old_image = item.get("image")

        # Passage ID remap
        if isinstance(old_passage_id, str) and PASSAGE_ID_RE.match(old_passage_id):
            if old_passage_id not in passage_id_map:
                passage_id_map[old_passage_id] = f"P{next_passage}"
                next_passage += 1
            item["passageId"] = passage_id_map[old_passage_id]

        # Image remap
        if isinstance(old_image, str):
            if NUMERIC_IMAGE_RE.match(old_image):
                item["image"] = f"{next_numeric}.png"
                next_numeric += 1

            elif PASSAGE_IMAGE_RE.match(old_image):
                if old_image not in passage_image_map:
                    if isinstance(old_passage_id, str) and old_passage_id in passage_id_map:
                        mapped_pid = passage_id_map[old_passage_id]  # e.g. P1
                        mapped_num = mapped_pid[1:]
                        passage_image_map[old_image] = f"p{mapped_num}.png"
                    else:
                        passage_image_map[old_image] = f"p{next_passage}.png"
                        next_passage += 1

                item["image"] = passage_image_map[old_image]

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"Updated: {json_path}")


def process_folders(folder_paths):
    for folder in folder_paths:
        json_path = Path(folder) / "assignment.json"
        if not json_path.exists():
            print(f"Skipping: {json_path} not found")
            continue

        try:
            renumber_single_assignment(json_path)
        except Exception as e:
            print(f"Failed on {json_path}: {e}")


if __name__ == "__main__":
    folders = [str(int(i)) for i in range(807, 813)] 


    process_folders(folders)