# Wrap Wizard

Wrap Wizard is a kid-friendly browser editor for creating Tesla Model Y 2025+
Premium visualization wraps. It supports picture uploads, OpenAI image
generation, native canvas editing, panel selection, and Tesla-ready PNG export.

## Run The Website

Requires Node.js 20 or newer.

```bash
export OPENAI_API_KEY="your-key-here"
npm start
```

Open [http://localhost:3000](http://localhost:3000).

The API key is used only by `server.js` and is never sent to the browser. Upload
and editing tools work without an API key; only **Make AI art** requires it.

Run the automated checks with:

```bash
npm test
```

## Website Features

- Large, kid-friendly controls and prompt ideas
- Upload PNG, JPEG, or WebP artwork
- Generate square wrap artwork with `gpt-image-1.5`
- Paint the entire vehicle, hood, roof, left doors, or right doors
- Drag, resize, rotate, flip, and reset artwork
- Live rendering through Tesla's official alpha mask
- Download a 1024x1024 transparent PNG

This workspace keeps AI-generated artwork separate from Tesla's official vehicle
mapping. GPT Image can create or edit the visual design, while the local scripts
preserve the template's exact panel geometry and transparent areas.

## Recommended Workflow

1. Generate a seamless or edge-to-edge square design with GPT Image.
2. Save it in `artwork/` as a PNG or JPEG.
3. Apply the official Tesla mask:

   ```bash
   python3 scripts/apply_artwork.py artwork/my_design.png \
     --output output/my_design_wrap.png
   ```

4. Validate the final file:

   ```bash
   python3 scripts/validate_wrap.py output/my_design_wrap.png
   ```

5. Copy the validated PNG to a USB drive in a root-level folder named `Wraps`.

## GPT Image Prompt Template

Use GPT Image to create the artwork layer, not to redraw Tesla's template:

```text
Create a 1024x1024 square, edge-to-edge vehicle wrap texture.
Design concept: [describe the theme].
Composition: bold readable shapes, balanced across the full canvas, with visual
interest near every edge. Use a continuous background so disconnected vehicle
panels still feel related.
Style and palette: [describe style and colors].
No car, no vehicle mockup, no panel outlines, no transparent background, no
logos, no text, no watermark, and no border.
```

For precise placement across doors or the hood, edit the official template while
keeping all transparent pixels and panel boundaries unchanged. AI edits can shift
those boundaries, so always run the result through `apply_artwork.py`.

## Tesla Requirements

- PNG format
- Square image from 512x512 through 1024x1024
- Maximum file size: 1 MB
- Up to 10 wrap images on the USB drive
- File name: alphanumeric characters, underscores, dashes, and spaces; 30
  characters maximum

Source: [Tesla custom-wraps repository](https://github.com/teslamotors/custom-wraps/tree/master/modely-2025-premium)
