from PIL import Image
import numpy as np

def crop_final(input_path, output_path, padding=10):
    img = Image.open(input_path)
    img = img.convert("RGBA")
    data = np.array(img)
    alpha = data[:, :, 3]
    
    # Threshold 5 allows faint pixels
    threshold = 5
    mask = alpha > threshold
    
    if not np.any(mask):
        print("Image appears fully transparent.")
        return

    h, w = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    
    # Store valid components' bbox coordinates to compute union
    valid_bboxes = []
    
    # Connect Component Analysis
    for y in range(h):
        for x in range(w):
            if mask[y, x] and not visited[y, x]:
                # BFS
                stack = [(y, x)]
                visited[y, x] = True
                
                min_y, max_y = y, y
                min_x, max_x = x, x
                pixel_count = 0
                
                while stack:
                    cy, cx = stack.pop()
                    pixel_count += 1
                    min_y = min(min_y, cy)
                    max_y = max(max_y, cy)
                    min_x = min(min_x, cx)
                    max_x = max(max_x, cx)
                    
                    for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w:
                            if mask[ny, nx] and not visited[ny, nx]:
                                visited[ny, nx] = True
                                stack.append((ny, nx))
                
                # LOGIC: 
                # The artifact is small (~442px) and far bottom-right.
                # The Logo components are larger (>500px).
                # Component 6 is ~509px (might be valid detail).
                # Let's clean up anything < 500px as artifact.
                if pixel_count > 500:
                    valid_bboxes.append((min_x, min_y, max_x, max_y))
                    print(f"Keeping Component: Size {pixel_count}, BBox {(min_x, min_y, max_x, max_y)}")
                else:
                    print(f"Discarding Artifact: Size {pixel_count}, BBox {(min_x, min_y, max_x, max_y)}")

    if not valid_bboxes:
        print("No valid logo components found.")
        return

    # Compute Union Bounding Box
    final_x1 = min(b[0] for b in valid_bboxes)
    final_y1 = min(b[1] for b in valid_bboxes)
    final_x2 = max(b[2] for b in valid_bboxes)
    final_y2 = max(b[3] for b in valid_bboxes)
    
    # Add Padding
    final_x1 = max(0, final_x1 - padding)
    final_y1 = max(0, final_y1 - padding)
    final_x2 = min(w, final_x2 + 1 + padding)
    final_y2 = min(h, final_y2 + 1 + padding)
    
    # Crop
    cropped_img = img.crop((final_x1, final_y1, final_x2, final_y2))
    cropped_img.save(output_path, "PNG")
    
    print(f"Final Smart Crop Saved to {output_path}")
    print(f"Original Size: {img.size}")
    print(f"Union BBox: ({final_x1}, {final_y1}, {final_x2}, {final_y2})")
    print(f"New Size: {cropped_img.size}")

if __name__ == "__main__":
    crop_final('apps/web/public/logo_transparent.png', 'apps/web/public/logo_trimmed.png', padding=5)
