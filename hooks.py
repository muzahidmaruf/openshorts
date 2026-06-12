import os
import subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FONT_DIR = "fonts"

def create_hook_image(text, target_width, output_image_path="hook_overlay.png",
                      font_scale=1.0, font_name=None, font_size=None):
    """
    Generates a white box with black text using pixel-based wrapping.
    target_width: The max width the box should occupy (e.g. 85% of video)
    font_name: PIL-compatible font family name (searches system fonts)
    font_size: explicit font size in px; if None, computed from target_width
    """
    # Determine font
    chosen_font = None
    if font_name:
        try:
            # Try to load by family name (Windows registry search)
            size = font_size or int(target_width * 0.05)
            chosen_font = ImageFont.truetype(font_name, int(size * font_scale))
        except Exception as e:
            print(f"⚠️ Could not load font '{font_name}': {e}")

    if chosen_font is None:
        # Fallback: download NotoSerif-Bold
        import urllib.request
        font_url = "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSerif/NotoSerif-Bold.ttf"
        font_path = os.path.join(FONT_DIR, "NotoSerif-Bold.ttf")
        if not os.path.exists(FONT_DIR):
            os.makedirs(FONT_DIR)
        if not os.path.exists(font_path):
            print(f"⬇️ Downloading fallback font...")
            try:
                req = urllib.request.Request(font_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req) as response, open(font_path, 'wb') as out_file:
                    out_file.write(response.read())
                print("✅ Fallback font downloaded.")
            except Exception as e:
                print(f"❌ Failed to download fallback font: {e}")
        try:
            size = font_size or int(target_width * 0.05)
            chosen_font = ImageFont.truetype(font_path, int(size * font_scale))
        except Exception as e:
            print(f"⚠️ Warning: Could not load fallback font, using default. Error: {e}")
            chosen_font = ImageFont.load_default()

    # Configuration
    padding_x = 30
    padding_y = 25
    line_spacing = 20
    cornerradius = 20
    shadow_offset = (5, 5)
    shadow_blur = 10

    # Wrap text logic (Pixel-based)
    dummy_img = Image.new('RGBA', (1, 1))
    draw = ImageDraw.Draw(dummy_img)

    max_text_width = target_width - (2 * padding_x)

    # Handle manual newlines first
    paragraphs = text.split('\n')
    lines = []

    for p in paragraphs:
        if not p.strip():
            lines.append("")
            continue

        words = p.split()
        current_line = []

        for word in words:
            test_line = ' '.join(current_line + [word])
            bbox = draw.textbbox((0, 0), test_line, font=chosen_font)
            w = bbox[2] - bbox[0]

            if w <= max_text_width:
                current_line.append(word)
            else:
                if current_line:
                    lines.append(' '.join(current_line))
                    current_line = [word]
                else:
                    lines.append(word)
                    current_line = []

        if current_line:
            lines.append(' '.join(current_line))

    # Recalculate true width/height
    max_line_width = 0
    text_heights = []

    for line in lines:
        if not line:
            text_heights.append(chosen_font.size)
            continue

        bbox = draw.textbbox((0, 0), line, font=chosen_font)
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        max_line_width = max(max_line_width, w)
        text_heights.append(h)

    # Box dimensions
    box_width = max(max_line_width + (2 * padding_x), int(target_width * 0.3))

    if not text_heights:
        total_text_height = chosen_font.size
    else:
        total_text_height = sum(text_heights) + (len(text_heights) - 1) * line_spacing

    box_height = total_text_height + (2 * padding_y)

    # Create Final Image with Rounded Corners and Shadow
    canvas_w = box_width + 40
    canvas_h = box_height + 40

    img = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Draw Shadow
    shadow_box = [
        (20 + shadow_offset[0], 20 + shadow_offset[1]),
        (20 + box_width + shadow_offset[0], 20 + box_height + shadow_offset[1])
    ]
    draw.rounded_rectangle(shadow_box, radius=cornerradius, fill=(0, 0, 0, 100))

    # Blur Shadow
    img = img.filter(ImageFilter.GaussianBlur(5))

    # Draw White Box
    draw_final = ImageDraw.Draw(img)

    main_box = [
        (20, 20),
        (20 + box_width, 20 + box_height)
    ]
    draw_final.rounded_rectangle(main_box, radius=cornerradius, fill=(255, 255, 255, 240))

    # Draw Text
    current_y = 20 + padding_y - 2
    for i, line in enumerate(lines):
        if not line:
            current_y += chosen_font.size + line_spacing
            continue

        bbox = draw_final.textbbox((0, 0), line, font=chosen_font)
        line_w = bbox[2] - bbox[0]
        line_h = text_heights[i] if i < len(text_heights) else bbox[3] - bbox[1]

        x = 20 + (box_width - line_w) // 2
        draw_final.text((x, current_y), line, font=chosen_font, fill="black")
        current_y += line_h + line_spacing

    img.save(output_image_path)
    return output_image_path, canvas_w, canvas_h

def add_hook_to_video(video_path, text, output_path, position="top",
                      font_scale=1.0, font_name=None, font_size=None):
    """
    Overlays text hook onto video.
    position: 'top', 'center', 'bottom'
    font_scale: float multiplier (1.0 = default)
    font_name: PIL-compatible font family name
    font_size: explicit font size in px
    """
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video {video_path} not found")

    # Probe video width to scale text properly
    try:
        cmd = ['ffprobe', '-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', video_path]
        res = subprocess.check_output(cmd).decode().strip()
        dims = res.split('\n')[0].split('x')
        video_width = int(dims[0])
        video_height = int(dims[1])
    except Exception as e:
        print(f"⚠️ FFprobe failed: {e}. Assuming 1080x1920")
        video_width = 1080
        video_height = 1920

    # Generate Image
    target_box_width = int(video_width * 0.9)

    hook_filename = f"temp_hook_{os.path.basename(video_path)}.png"

    try:
        img_path, box_w, box_h = create_hook_image(
            text, target_box_width, hook_filename,
            font_scale=font_scale, font_name=font_name, font_size=font_size
        )

        # Calculate Overlay Position
        overlay_x = (video_width - box_w) // 2

        if position == "center":
            overlay_y = (video_height - box_h) // 2
        elif position == "bottom":
            overlay_y = int(video_height * 0.70)
        else:
            overlay_y = int(video_height * 0.20)

        # FFmpeg Command
        print(f"🎬 Overlaying hook: '{text}' at {overlay_x},{overlay_y}")

        ffmpeg_cmd = [
            'ffmpeg', '-y',
            '-i', video_path,
            '-i', img_path,
            '-filter_complex', f"[0:v][1:v]overlay={overlay_x}:{overlay_y}",
            '-c:a', 'copy',
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
            output_path
        ]

        subprocess.run(ffmpeg_cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        print(f"✅ Hook added to {output_path}")
        return True

    except subprocess.CalledProcessError as e:
        err = e.stderr.decode() if e.stderr else 'Unknown'
        print(f"❌ FFmpeg Error: {err}")
        raise e
    except Exception as e:
        print(f"❌ Hook Gen Error: {e}")
        raise e
    finally:
        if os.path.exists(hook_filename):
            os.remove(hook_filename)
