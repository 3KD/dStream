from PIL import Image
import sys

def crop_transparent(input_path, output_path):
    img = Image.open(input_path)
    img = img.convert("RGBA")
    
    # Get bounding box of non-transparent pixels
    bbox = img.getbbox()
    
    if bbox:
        cropped_img = img.crop(bbox)
        cropped_img.save(output_path, "PNG")
        print(f"Cropped logo saved to {output_path}")
        print(f"Original size: {img.size}, New size: {cropped_img.size}")
    else:
        print("Image is fully transparent, nothing to crop.")

if __name__ == "__main__":
    crop_transparent('apps/web/public/logo_transparent.png', 'apps/web/public/logo_trimmed.png')
