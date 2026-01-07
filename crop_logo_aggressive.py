from PIL import Image
import sys
import numpy as np

def crop_transparent_aggressive(input_path, output_path, padding=1):
    img = Image.open(input_path)
    img = img.convert("RGBA")
    
    # Convert to numpy array for faster processing
    data = np.array(img)
    
    # Create binary mask of non-transparent pixels
    # Extract alpha channel
    alpha = data[:, :, 3]
    
    # Threshold 5 (was 15) to ensure we capture faint tips/edges
    threshold = 5
    mask = alpha > threshold
    
    if not np.any(mask):
        print("Image appears fully transparent.")
        return

    # Connected Component Analysis to find the largest object (Main Logo)
    # and ignore small artifacts (like the diamond).
    
    # Simple BFS for labeled components
    h, w = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    labels = np.zeros_like(mask, dtype=int)
    current_label = 0
    component_sizes = {}
    
    for y in range(h):
        for x in range(w):
            if mask[y, x] and not visited[y, x]:
                current_label += 1
                # BFS
                stack = [(y, x)]
                visited[y, x] = True
                labels[y, x] = current_label
                count = 0
                
                while stack:
                    cy, cx = stack.pop()
                    count += 1
                    
                    # 4-connectivity
                    for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w:
                            if mask[ny, nx] and not visited[ny, nx]:
                                visited[ny, nx] = True
                                labels[ny, nx] = current_label
                                stack.append((ny, nx))
                
                component_sizes[current_label] = count

    if not component_sizes:
        print("No components found.")
        return

    # Find largest component
    largest_label = max(component_sizes, key=component_sizes.get)
    print(f"Found {len(component_sizes)} components. Keeping largest (Label {largest_label}, Size {component_sizes[largest_label]} pixels).")
    
    # Create mask for ONLY the largest component
    final_mask = (labels == largest_label)
    
    # Get bounding box of the largest component
    rows = np.any(final_mask, axis=1)
    cols = np.any(final_mask, axis=0)
    
    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]
    
    # Add padding (10 pixels requested for safety)
    safe_padding = 10
    rmin = max(0, rmin - safe_padding)
    rmax = min(img.height, rmax + 1 + safe_padding)
    cmin = max(0, cmin - safe_padding)
    cmax = min(img.width, cmax + 1 + safe_padding)
    
    # Crop
    cropped_img = img.crop((cmin, rmin, cmax, rmax))
    cropped_img.save(output_path, "PNG")
    
    print(f"Smart-cropped logo saved to {output_path}")
    print(f"Original size: {img.size}")
    print(f"Cropped region: left={cmin}, top={rmin}, right={cmax}, bottom={rmax}")
    print(f"New size: {cropped_img.size}")

if __name__ == "__main__":
    # Input is the transparent one we made earlier
    crop_transparent_aggressive('apps/web/public/logo_transparent.png', 'apps/web/public/logo_trimmed.png', padding=1)
