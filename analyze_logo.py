from PIL import Image
import numpy as np

def analyze_components(input_path):
    img = Image.open(input_path)
    img = img.convert("RGBA")
    data = np.array(img)
    alpha = data[:, :, 3]
    
    # Threshold 5 allows faint pixels to be included
    threshold = 5
    mask = alpha > threshold
    
    if not np.any(mask):
        print("Image appears fully transparent.")
        return

    h, w = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    labels = np.zeros_like(mask, dtype=int)
    current_label = 0
    components = []
    
    print(f"Analyzing {input_path} ({w}x{h})...")

    for y in range(h):
        for x in range(w):
            if mask[y, x] and not visited[y, x]:
                current_label += 1
                stack = [(y, x)]
                visited[y, x] = True
                
                min_y, max_y = y, y
                min_x, max_x = x, x
                count = 0
                
                while stack:
                    cy, cx = stack.pop()
                    count += 1
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
                
                components.append({
                    'label': current_label,
                    'count': count,
                    'bbox': (min_x, min_y, max_x, max_y),
                    'dims': (max_x - min_x + 1, max_y - min_y + 1)
                })

    print(f"Found {len(components)} components.")
    # Sort by size (pixel count) descending
    components.sort(key=lambda x: x['count'], reverse=True)
    
    for i, c in enumerate(components):
        print(f"Component {i+1}: Size {c['count']} px | BBox {c['bbox']} (x1, y1, x2, y2) | Dims {c['dims']}")

if __name__ == "__main__":
    analyze_components('apps/web/public/logo_transparent.png')
