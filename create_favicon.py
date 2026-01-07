from PIL import Image, ImageDraw
import sys

def create_circle_icon(input_path, output_path):
    # Open original logo
    img = Image.open(input_path).convert("RGBA")
    
    # Calculate dimensions
    # We want a square image where the circle fills it, and the logo sits inside
    # Let's add some padding so the logo isn't touching the circle edges
    
    # Max dimension of the logo
    max_dim = max(img.width, img.height)
    
    # Scale factor: Logo should be ~70% of the circle diameter
    # circle_diameter = max_dim / 0.7
    circle_diameter = int(max_dim * 1.4)
    
    # Create new base image (transparent)
    base = Image.new('RGBA', (circle_diameter, circle_diameter), (0, 0, 0, 0))
    draw = ImageDraw.Draw(base)
    
    # Draw black circle
    draw.ellipse((0, 0, circle_diameter - 1, circle_diameter - 1), fill=(0, 0, 0, 255))
    
    # Paste logo in center
    # Calculate center offset
    offset_x = (circle_diameter - img.width) // 2
    offset_y = (circle_diameter - img.height) // 2
    
    base.paste(img, (offset_x, offset_y), img)
    
    # Resize to standard icon sizes (e.g. 256x256 is good for high-res favicon)
    # But keeping it high res is fine too, browser will scale against the circle
    final_size = (256, 256)
    base = base.resize(final_size, Image.Resampling.LANCZOS)
    
    base.save(output_path, "PNG")
    print(f"Created circular icon at {output_path}")

if __name__ == "__main__":
    create_circle_icon('apps/web/public/logo_trimmed.png', 'apps/web/public/logo_circle.png')
