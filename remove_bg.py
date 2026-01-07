from PIL import Image
import sys

def remove_background(input_path, output_path):
    img = Image.open(input_path)
    img = img.convert("RGBA")
    datas = img.getdata()

    newData = []
    for item in datas:
        # Change all black (also shades of black) pixels to transparent
        if item[0] < 50 and item[1] < 50 and item[2] < 50:
            newData.append((255, 255, 255, 0))
        else:
            newData.append(item)

    img.putdata(newData)
    img.save(output_path, "PNG")
    print("Saved transparent logo to", output_path)

if __name__ == "__main__":
    remove_background('apps/web/public/logo_new.png', 'apps/web/public/logo_transparent.png')
