# pdf_converter.py

import fitz  # PyMuPDF
import os
import getpass
from typing import Optional

DEFAULT_PASSWORD = "awesomePREPALLY"

def _render_pixmap(page: fitz.Page, zoom: float = 2.0) -> "fitz.Pixmap":
    """
    Compatible page-to-pixmap renderer across PyMuPDF versions.
    Newer versions: page.get_pixmap()
    Older versions: page.getPixmap()
    """
    mat = fitz.Matrix(zoom, zoom)
    # Newer API
    if hasattr(page, "get_pixmap"):
        return page.get_pixmap(matrix=mat)
    # Fallback for older PyMuPDF
    return page.getPixmap(matrix=mat)

def _save_unlocked_copy(doc: fitz.Document, src_pdf_path: str) -> str:
    unlocked_pdf_path = os.path.splitext(src_pdf_path)[0] + "_unlocked.pdf"

    # Use the correct constant if available; fallback to 0 which means "no encryption"
    encrypt_none = getattr(fitz, "PDF_ENCRYPT_NONE", 0)

    # If an unlocked copy already exists, don't overwrite—just reuse it.
    if os.path.exists(unlocked_pdf_path):
        print(f"🔓 Unlocked copy already exists: {unlocked_pdf_path}")
        return unlocked_pdf_path

    doc.save(unlocked_pdf_path, encryption=encrypt_none)
    print(f"🔓 Saved unlocked PDF as: {unlocked_pdf_path}")
    return unlocked_pdf_path

def _authenticate_if_needed(doc: fitz.Document) -> bool:
    """Try default password, then prompt the user until success."""
    if not doc.is_encrypted:
        return True

    if doc.authenticate(DEFAULT_PASSWORD):
        print("✅ Successfully authenticated with the default password.")
        return True

    print("Default password failed.")
    while True:
        user_password = getpass.getpass("Please enter the PDF password: ")
        if doc.authenticate(user_password):
            print("✅ Password accepted!")
            return True
        print("❌ Incorrect password. Please try again.")

def convert_pdf_to_images(pdf_path: str):
    """
    Converts each page of a (possibly password-protected) PDF into PNG images.
    - If encrypted, authenticates and writes an *unlocked* copy (…_unlocked.pdf).
    - Skips work if an unlocked copy already exists and/or if images folder already exists.
    """

    if not pdf_path.lower().endswith(".pdf"):
        return
    if not os.path.exists(pdf_path):
        return

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(f"\nError opening PDF: {e}")
        return

    # If encrypted, authenticate; then save / reuse an unlocked copy
    if doc.is_encrypted:
        if not _authenticate_if_needed(doc):
            print("❌ Could not authenticate. Skipping.")
            return
        # Write unlocked copy (or reuse existing one)
        unlocked_pdf_path = _save_unlocked_copy(doc, pdf_path)
        # Reopen from the unlocked file to ensure subsequent ops don't require a password
        doc.close()
        try:
            doc = fitz.open(unlocked_pdf_path)
        except Exception as e:
            print(f"\nError reopening unlocked PDF: {e}")
            return
        work_pdf_path = unlocked_pdf_path
    else:
        # If a prior unlocked copy exists, prefer that (skip reconversion of same content)
        unlocked_pdf_path = os.path.splitext(pdf_path)[0] + "_unlocked.pdf"
        work_pdf_path = unlocked_pdf_path if os.path.exists(unlocked_pdf_path) else pdf_path

        if work_pdf_path != pdf_path:
            # Reopen using the unlocked copy
            doc.close()
            try:
                doc = fitz.open(work_pdf_path)
                print(f"ℹ️ Using existing unlocked copy: {work_pdf_path}")
            except Exception as e:
                print(f"\nError opening existing unlocked PDF: {e}")
                return

    # Images output directory (based on the PDF actually being processed)
    pdf_stem = os.path.splitext(work_pdf_path)[0]
    output_dir = f"{pdf_stem}_pages"

    # --- Skip reconverting logic ---
    # If the images folder already exists, skip this PDF.
    if os.path.exists(output_dir) and os.path.isdir(output_dir):
        print(f"⏭️ Skipping (images already exist): {output_dir}")
        doc.close()
        return

    os.makedirs(output_dir, exist_ok=True)
    print(f"\n📁 Created directory for images: '{output_dir}'")

    total_pages = len(doc)
    print(f"🖼️ Starting conversion of {total_pages} pages from: {work_pdf_path}")

    for i in range(total_pages):
        page = doc.load_page(i)
        pix = _render_pixmap(page, zoom=2.0)  # ~144 DPI equivalent
        output_image_path = os.path.join(output_dir, f"page_{i + 1:04d}.png")
        pix.save(output_image_path)
        print(f"    -> Saved page {i + 1} as {output_image_path}")

    doc.close()

def _iter_pdf_paths(root_dir: str):
    """Yield PDF file paths under root_dir, depth-first."""
    for root, _, files in os.walk(root_dir):
        for f in files:
            if f.lower().endswith(".pdf"):
                yield os.path.join(root, f)

if __name__ == "__main__":
    for pdf in _iter_pdf_paths("."):
        convert_pdf_to_images(pdf)
