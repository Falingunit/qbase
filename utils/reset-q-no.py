import json
import re
from pathlib import Path
from typing import Dict, List, Optional


NUMERIC_IMAGE_RE = re.compile(r"^(\d+)\.png$")
PASSAGE_IMAGE_RE = re.compile(r"^p(\d+)\.png$", re.IGNORECASE)
PASSAGE_ID_RE = re.compile(r"^P(\d+)$", re.IGNORECASE)


def process_assignment_files(folder_paths: List[str], backup: bool = True) -> None:
    """
    Process assignment.json in each folder, renumbering:
      - numeric images -> 1.png, 2.png, 3.png, ...
      - passage images -> p1.png, p2.png, ...
      - passage IDs -> P1, P2, ...

    Numbering is continuous across all folders in the order provided.
    """

    next_numeric_image = 1
    next_passage = 1

    # Global mappings so repeated references stay consistent across folders
    passage_id_map: Dict[str, str] = {}
    passage_image_map: Dict[str, str] = {}

    for folder in folder_paths:
        folder_path = Path(folder)
        json_path = folder_path / "assignment.json"

        if not json_path.exists():
            print(f"Skipping: {json_path} not found")
            continue

        try:
            with json_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            print(f"Failed to read {json_path}: {e}")
            continue

        if not isinstance(data, list):
            print(f"Skipping {json_path}: root JSON is not a list")
            continue

        for item in data:
            if not isinstance(item, dict):
                continue

            old_passage_id: Optional[str] = item.get("passageId")
            old_image: Optional[str] = item.get("image")

            # Handle passageId first
            if isinstance(old_passage_id, str) and PASSAGE_ID_RE.match(old_passage_id):
                if old_passage_id not in passage_id_map:
                    passage_id_map[old_passage_id] = f"P{next_passage}"
                    next_passage += 1
                item["passageId"] = passage_id_map[old_passage_id]

            # Handle image
            if isinstance(old_image, str):
                # Numeric image like 18.png
                if NUMERIC_IMAGE_RE.match(old_image):
                    item["image"] = f"{next_numeric_image}.png"
                    next_numeric_image += 1

                # Passage image like p3.png
                elif PASSAGE_IMAGE_RE.match(old_image):
                    if old_image not in passage_image_map:
                        # Reuse mapped passage number if possible
                        linked_passage_id = old_passage_id if isinstance(old_passage_id, str) else None

                        if linked_passage_id and linked_passage_id in passage_id_map:
                            new_passage_num = passage_id_map[linked_passage_id][1:]  # drop 'P'
                            passage_image_map[old_image] = f"p{new_passage_num}.png"
                        else:
                            passage_image_map[old_image] = f"p{next_passage}.png"
                            if linked_passage_id and linked_passage_id not in passage_id_map:
                                passage_id_map[linked_passage_id] = f"P{next_passage}"
                            next_passage += 1

                    item["image"] = passage_image_map[old_image]

        if backup:
            backup_path = json_path.with_name("assignment.json.bak")
            try:
                backup_path.write_text(json_path.read_text(encoding="utf-8"), encoding="utf-8")
            except Exception as e:
                print(f"Warning: could not create backup for {json_path}: {e}")

        try:
            with json_path.open("w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            print(f"Updated: {json_path}")
        except Exception as e:
            print(f"Failed to write {json_path}: {e}")


if __name__ == "__main__":
    # Put your folders here in the exact order you want processed
    folders = [str(int(i)) for i in range(807, 813)] 

    process_assignment_files(folders, backup=True)