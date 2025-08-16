# pdf_converter.py

import fitz  # PyMuPDF library
import os
import getpass

def convert_pdf_to_images(pdf_path):
    """
    Prompts the user for a PDF file and converts each page into a PNG image.
    It handles password-protected files by first trying a default password
    and then asking the user if that fails.
    """

    if not os.path.exists(pdf_path):
        return

    if not pdf_path.lower().endswith('.pdf'):
        return

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(f"\nError opening PDF: {e}")
        return

    # 3. Handle password if the PDF is encrypted
    if doc.is_encrypted:
        default_password = "awesomePREPALLY"
        if doc.authenticate(default_password):
            print("Successfully authenticated with the default password.")
        else:
            print("The default password failed.")
            while True:
                user_password = getpass.getpass("Please enter the PDF password: ")
                if doc.authenticate(user_password):
                    print("Password accepted!")
                    break
                else:
                    print("Incorrect password. Please try again.")

    pdf_filename = os.path.splitext(pdf_path)[0]
    output_dir = f"{pdf_filename}_pages"
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"\nCreated directory for images: '{output_dir}'")
    else:
        return

    # 5. Convert each page to an image
    total_pages = len(doc)
    print(f"Starting conversion of {total_pages} pages...")

    for i in range(total_pages):
        page = doc.load_page(i)
        
        # Increase zoom for higher resolution (e.g., zoom=2 for 144 DPI)
        zoom = 2 
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        
        # Format filename with leading zeros for proper sorting (e.g., page_0001.png)
        output_image_path = os.path.join(output_dir, f"page_{i + 1:04d}.png")
        pix.save(output_image_path)
        
        print(f"    -> Saved page {i + 1} as {output_image_path}")
        
    doc.close()

if __name__ == "__main__":
    import os

for filename in os.listdir('.'):
    for root, dirs, files in os.walk('.'):
        for file in files:
            file_path = os.path.join(root, file)
            convert_pdf_to_images(file_path)