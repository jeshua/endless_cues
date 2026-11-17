# QLab 5 feature inventory: Video and Lighting

Source: the official QLab 5 manual, https://qlab.app/docs/v5/ , fetched 2026-11-13. Every page in the Video and
Lighting sections was read in full, plus the supporting pages named under each heading. Licence tier is marked
**[Free]**, **[Video]**, **[Lighting]**, **[Any licence]** where the manual says; unmarked bullets are behaviours the
manual does not tie to a tier (inside a licensed feature they inherit that feature's tier).

Tier summary (from https://qlab.app/docs/v5/general/features/):
free = 1 single-output stage, full-stage Video cues, 1000 layers, 16 patchable DMX addresses.
Video licence = everything else in video. Lighting licence = more than 16 DMX addresses (nothing else in lighting is gated).

---

## 1. Video signal model and terminology
https://qlab.app/docs/v5/video/introduction-to-video/ , https://qlab.app/docs/v5/video/video-output/

- Video engine is built on Apple's Metal framework (rewritten for v5).
- Three cue types produce video: Video cue (files/stills), Camera cue (live input), Text cue (rendered styled text).
- Signal path is Source → Cue → Stage → Region → Route → Device.
- A stage is a virtual raster that cues are assigned to; it is QLab's "video output patch".
- A stage is divided into regions; a region covers all or part of the stage; regions may overlap.
- Each region is assigned to exactly one output route.
- Each output route represents exactly one output device.
- Routes are an indirection layer so hardware can be swapped without touching cues, stages or regions.
- Output device types: any display macOS lists in Displays; Blackmagic Design outputs; any number of Syphon outputs; any number of NDI outputs (limited by machine resources).
- USB DisplayLink displays are not recommended or supported.
- AirPlay output is not supported (variable latency).
- Resolution-agnostic: any compatible media plays on any stage with no need to match resolution.
- Frame-rate-agnostic: sources need not match device frame rate; cues with different frame rates can share a stage simultaneously.
- A stage larger than the imagery is surrounded by black; a stage smaller than the imagery lets imagery extend off the canvas.
- Maximum stage size 16384 × 16384 pixels.
- "Projection" naming convention: screen and display used interchangeably for any physical output.

## 2. Video cues: files, codecs, formats
https://qlab.app/docs/v5/video/video-cues/

- A Video cue requires a file target (video or still image) and a stage assignment.
- A still-image Video cue runs indefinitely until stopped unless given a finite duration.
- Compatible moving-image codecs: MPEG-1, MPEG-2, MPEG-4, H.263, H.264, H.265/HEVC.
- Compatible ProRes codecs: 422 Proxy, 422 LT, 422, 422 HQ, 4444, 4444 XQ.
- Compatible other codecs: Photo-JPEG; DV/DVCPRO NTSC, DVCPRO50 NTSC, DV PAL, DVCPRO PAL, DVCPRO50 PAL.
- Compatible Hap codecs: Hap Standard, Hap Alpha, Hap Q.
- Recommended codecs without transparency, in order: ProRes 422 Proxy, Hap Standard, ProRes 422 LT, Hap Q, Photo-JPEG.
- ProRes 422 / 422 HQ usable for higher quality at higher processing cost.
- Recommended codecs with transparency, in order: ProRes 4444, Hap Alpha (ProRes 4444 XQ for top quality).
- Alpha-channel video is supported and must be rendered with premultiplied alpha.
- H.264 and H.265 work but perform poorly when sped up, slowed down or scrubbed.
- Recommended containers: .mov and .mp4; others may work but are not recommended.
- Still images: most formats work; PNG and JPG recommended.
- PSD and PDF are not supported as stills.
- File target larger than 16,000 px in width or height is rejected (cue is broken).
- QLab prevents choosing a file with an incompatible codec as a target.

## 3. Video cue inspector: I/O tab
https://qlab.app/docs/v5/video/video-cues/

- File Target field shows the path; double-click to choose a file, or drag and drop from Finder.
- Button to clear the file target (does not delete the file).
- Button to reveal the file target in Finder.
- The same target controls are duplicated in the Basics tab.
- Video Format readout: codec, pixel dimensions, frame rate of the target.
- Clock pop-up: "Follow video clock" (display clock drives timing; smoothest picture, may drift from other cues' audio).
- Clock pop-up: "Follow audio clock" (audio device clock drives timing; stays in sync with cues on the same audio patch, may skip/repeat a frame).
- For multi-output stages the video clock is chosen by heuristic: highest refresh rate, then physical over virtual (NDI/Syphon), then arbitrary.
- Audio Format readout: codec, channel count, sample rate of the embedded audio.
- Audio track pop-up when the file has multiple audio tracks; each item shows codec, channels, channel layout, sample rate.
- Video Output pop-up assigns the cue to exactly one stage.
- Video Output pop-up offers "(unpatched)" so the cue will not play when started.
- Video Output pop-up shortcut: "Open Video Settings to edit stage list…".
- Video Output pop-up shortcut: "New stage with video route" creates and selects a new stage.
- Monitor button opens the monitor window for the selected stage.
- Readout of the selected stage's true pixel dimensions (not Retina points).
- Edit… button opens the video stage editor for the selected stage.
- Audio Output pop-up selects an audio output patch, with "(unpatched)", "Open Audio Settings…", "New patch with audio device".
- Readout of the audio device sample rate, and Edit… button opening the audio output patch editor.

## 4. Video cue inspector: Geometry tab
https://qlab.app/docs/v5/video/video-cues/

- Mode pop-up: Fill Stage or Custom. **[Custom geometry: Video]**; **[Fill Stage: Free]**
- Fill Stage style "Fit": scaled as large as possible showing the whole image, aspect preserved; empty areas are transparent (lower layers show through), not black.
- Fill Stage style "Fill": scaled to cover every stage pixel, aspect preserved, overflow cropped.
- Fill Stage style "Stretch": scaled asymmetrically to cover the stage exactly.
- Opacity 0%–100% per cue, with reset button; source transparency is preserved at 100%.
- Smooth checkbox: anti-aliased scaling when on, nearest-neighbour scaling when off.
- Layer per cue: 1001 layers (top, 999…1, bottom). **[Free]** ("1000 video layers")
- Cues on the same layer stack in start order (last started on top).
- Higher layers always draw above lower layers regardless of start order.
- Custom mode displays the cue at natural pixel dimensions.
- Custom mode shows a thumbnail of the cue inside a blue box representing the stage.
- Crop: four fields (top, bottom, left, right) in pixels from each edge inward, with reset.
- Crop is not fade-able (Shutter or Window video effect is the fade-able substitute).
- Translation in pixels relative to stage centre; (0,0) centred; positive is up and right; with reset.
- Translation adjustable by dragging the thumbnail.
- Scale as a multiplier of natural size (1.0 natural), X and Y fields with an aspect lock toggle; with reset.
- Scale adjustable by vertical scrolling over the thumbnail.
- Rotation in 3D about X, Y and Z: drag on the X/Y/Z buttons or type values; with reset.
- Rotation uses quaternions; displayed number is relative degrees for the current adjustment, not an absolute angle.
- Anchor point around which the cue rotates, translates and scales; default (0,0) = cue centre; with reset.
- Anchor adjustable by dragging the light-blue cross in the thumbnail.

## 5. Video cue inspector: Time & Loops, audio tabs
https://qlab.app/docs/v5/video/video-cues/ (Time & Loops details from https://qlab.app/docs/v5/audio/audio-cues/)

- Time & Loops tab is the same as for Audio cues, plus "Hold at end".
- Hold at end: the final frame stays visible and the cue stays active until stopped.
- Without Hold at end the cue stops itself after its last frame.
- Start time and end time, set by typing, dragging markers, or ⇧I / ⇧O at the playback position.
- Play count (whole number) and Infinite loop.
- Slices: markers split the cue into sections each with its own play count (M adds a slice). **[Free: unlimited slices]**
- A slice play count can be infinite, or 0 to skip the slice seamlessly.
- Slice markers cannot be closer than 0.05 s.
- Devamp cue can exit a looping slice (Devamp **[Any licence]**).
- Playback Rate from 0.03 to 33, with optional Preserve pitch for the audio.
- Integrated fade envelope on the cue (custom or linear curve; lock to start/end).
- Waveform zoom, preview (V) and reset buttons in the tab.
- Levels tab appears only if the target has audio; behaves as for Audio cues.
- Input channel names come from the file's channel-layout metadata (e.g. 5.1) and can be renamed via the Inputs button without altering the file.
- Objects tab (object audio) appears only if the target has audio.
- Trim tab appears only if the target has audio.
- Audio FX tab appears only if the target has audio.

## 6. Video FX tab, blend modes
https://qlab.app/docs/v5/video/video-cues/ , https://qlab.app/docs/v5/video/blend-modes/ , https://qlab.app/docs/v5/scripting/parameter-reference/ , https://qlab.app/docs/v5/tutorials/blend-mode-demo/

- Blend Mode pop-up per cue governs how the cue combines with cues on lower layers. **[Video]**
- Blend math is per pixel per channel on a 0.0–1.0 scale, foreground (higher layer) against background (lower layer).
- Blend mode: Normal.
- Darkening blends: Darken, Multiply, Color Burn, Linear Burn.
- Lightening blends: Lighten, Screen, Color Dodge, Linear Dodge.
- Contrast blends: Overlay, Soft Light, Hard Light, Pin Light.
- Arithmetic blends: Difference, Exclusion, Subtract, Divide.
- Component blends: Hue, Saturation, Color, Luminosity.
- Compositing blends: Addition Compositing, Maximum Compositing, Source Atop Compositing.
- Source Atop lets a background cue act as a key and the foreground as fill.
- Blend modes are scriptable by full name string (OSC `/cue/{n}/blendMode`).
- "Add video effect…" pop-up adds an effect to a cue. **[Video]**
- Multiple video effects per cue, rendered in list order.
- Effects are live (rendered in real time).
- Selecting an effect shows its parameters as text fields, sliders and colour swatches.
- "Set Default Parameters" resets only the visible effect.
- Remove button per effect.
- Effects can be enabled/disabled, reordered, inserted and deleted via OSC (`/cue/{n}/videoEffect/...`), and parameters set live.

## 7. Video effects list (each with scriptable parameters)
https://qlab.app/docs/v5/scripting/parameter-reference/

- Color Controls: brightness, contrast, hue angle, saturation.
- Exposure: exposure value.
- Gamma: power.
- Sepia / Monochrome: choose effect, colour, intensity.
- Min / Max / Invert: minimum component, maximum component, colour invert.
- White Point: colour.
- Highlights and Shadows: highlight, shadow, radius.
- Temperature and Tint: source temperature/tint, target temperature/tint.
- Vibrance: amount.
- Tone Curve: five X/Y points.
- Color Clamp: min/max for R, G, B, A.
- Color Matrix: full 4×4 RGBA matrix plus bias per channel.
- Color Threshold: threshold.
- Spot Color: three centre/replacement colour pairs with closeness and contrast.
- Linear Key: key colour (green or blue), cutoff, contrast (chroma key to alpha).
- Box / Disc / Gaussian Blur: choose blur, radius.
- Bokeh Blur: radius, ring amount, ring size, softness.
- Motion Blur: radius, angle.
- Sharpen Luminance: sharpness.
- Unsharp Mask: radius, intensity.
- Zoom Blur: centre X/Y, amount.
- Morphology Gradient: radius.
- Morphology Min / Max: choose, width, height.
- Depth of Field: two points, radius, saturation, unsharp mask intensity/radius.
- Pixellation: square or hexagonal, centre, scale.
- Screen: dot, line, hatched or circular screen; centre, angle, width, sharpness.
- Bloom and Gloom: choose, radius, intensity.
- CMYK Halftone: centre, angle, width, sharpness, GCR, UCR.
- Photo Effects: Chrome, Fade, Instant, Mono, Noir, Process, Tonal, Transfer.
- Color Posterize: levels.
- Crystallize and Pointillize: choose, centre, radius.
- Edge Work: Edge Work or Edges; intensity, radius.
- Line Overlay: contrast, edge intensity, threshold, NR noise level, NR sharpness.
- Kaleidoscope: centre, angle, count.
- Triangle Kaleidoscope: centre, rotation, size, decay.
- Droste: two inset points, periodicity, strands, zoom, rotation.
- Light Tunnel: centre, radius, rotation.
- Median and Comic Effect: choose.
- False Color (no scriptable parameters).
- Thermal / X-Ray: choose.
- Gabor Gradients (no parameters).
- Spotlight: colour, brightness, concentration, light position XYZ, points-at XYZ.
- Dither: intensity.
- Noise Reduction: noise level, sharpness.
- Circle Splash / Hole Distortion: choose, centre, radius.
- Pinch / Bump Distortion: pinch, bump or bump linear; centre, radius, angle, scale.
- Torus / Lens Distortion: centre, radius, width, refraction.
- Twirl / Circular Wrap / Vortex: choose, centre, radius, angle.
- Glass Lozenge: two points, radius, refraction.
- Keystone Correction (per cue): combined/horizontal/vertical, four corner X/Y, focal length.
- Op Tile: centre, angle, scale, width.
- Perspective Tile: four corner X/Y.
- Quad Tiles: fourfold translated, fourfold reflected or parallelogram; centre, angle, acute angle, width.
- Reflected Tiles: glide, sixfold, eightfold or twelvefold reflected; centre, angle, width.
- Rotated Tiles: triangle, fourfold or sixfold; centre, angle, width.
- Nine-Part Stretched: lower-left, upper-right, grow X/Y.
- Nine-Part Tiled: lower-left, upper-right, grow X/Y, flip vertically.
- Shutter: rectangle or ellipse; left, right, bottom, top, feather (fade-able crop).
- Window: origin X/Y, width, height (fade-able crop).
- Drop Shadow: distance, angle, blur radius, alpha, colour.

## 8. Broken Video cue warnings
https://qlab.app/docs/v5/video/video-cues/

- Warning: no video file selected.
- Warning: missing video file.
- Warning: file target is in the Trash.
- Warning: file target lacks read permissions.
- Warning: file target uses an incompatible codec.
- Warning: file target is an incorrect size (over 16,000 px).
- Warning: no video output stage assigned.
- Warning: incomplete video output (stage not fully configured).
- Warning: no audio output patch although the file has audio.
- Warning: issue with the audio output patch.
- Warning: NDI output used for audio has no audio channels.
- Warning: missing audio effect (AudioUnit not installed).
- Warning: invalid slice play counts (all slices 0).
- Warning: licence required for custom geometry, blend modes, video effects, audio effects or Timecode triggers. **[Video]**

## 9. Camera cues
https://qlab.app/docs/v5/video/camera-cues/

- Camera cue shows live video with the same cueing, routing, geometry and effects as Video cues. **[Video]**
- Every Camera cue embeds a Mic cue for live audio; audio source may be the video device or a different one.
- Camera cue runs indefinitely unless given a finite duration.
- Source: any USB video device class (UVC) camera or capture device.
- Source: any IIDC-compliant (FireWire/DV) device.
- Source: any Blackmagic Design DeckLink, UltraStudio or Intensity device.
- Source: any Syphon source on the Mac.
- Source: any NDI source on the local network.
- Requires macOS Camera permission (and Microphone permission for audio).
- I/O tab Video Input pop-up selects a video input patch, with "(unpatched)", "Open Camera Settings…", "New patch with camera device".
- Monitor button shows a live view of the selected input patch.
- Audio Input pop-up selects an audio input patch or "(unpatched)" for no audio.
- With an NDI video source the cue automatically uses the NDI stream's audio and cannot use another audio source.
- Input channel count 1–24 and a starting input channel selector.
- Sample-rate readout for the audio input device (may be blank for virtual devices).
- Video Output (stage) pop-up, Monitor, pixel-size readout and Edit…, as for Video cues.
- Audio Output patch pop-up and Edit…, as for Video cues; input and output devices may differ.
- Geometry tab identical to Video cues.
- Levels, Objects, Trim and Audio FX tabs appear when the cue uses audio.
- Video FX tab identical to Video cues.
- Main audio level of Camera cues defaults to -inf.
- Warnings: no camera access; no video input patch; incomplete video input patch; no video output stage; incomplete video output patch.
- Warnings: no microphone access; not enough input channels; issue with audio input patch; no audio output patch; issue with audio output patch; NDI output lacks audio channels; missing audio effect.
- Warning: video licence required to use Camera cues.

## 10. Text cues
https://qlab.app/docs/v5/video/text-cues/ (OSC names from https://qlab.app/docs/v5/scripting/osc-dictionary-v5/)

- Text cue renders styled text as video with every Video cue feature (geometry, effects, fades). **[Video]**
- The manual has no separate "Titles" cue type; Text cues are the only title mechanism.
- Text is rendered to a PNG image when the cue starts.
- I/O tab has only the Video Output (stage) pop-up, Monitor, size readout and Edit….
- Geometry tab identical to Video cues.
- Text editing area behaves like standard macOS text editing; drawn white on black because the default background is transparent.
- Font panel button sets typeface, size and style of the selected text.
- One Text cue can mix multiple fonts/sizes/styles (rich text).
- Text colour picker for the selected text.
- Background colour picker for the selected text.
- Alignment buttons: left, centre, justified, right; one alignment for the whole cue.
- Width field sets the rendered image width; height is automatic from the text.
- Default image size is auto-fitted to the text; rendered dimensions are displayed.
- Height can be padded with blank lines.
- Line Spacing field.
- Preview scale pop-up changes only the inspector's display size.
- Ruler above the text field showing the cue's width in pixels.
- Video FX tab identical to Video cues.
- Text content can be set live over OSC (`/cue/{n}/text`, `/text/live`).
- OSC exposes per-range format: font family/style/name/size, colour, background colour, alignment, line spacing.
- OSC exposes underline style/colour, strikethrough style/colour, and shadow colour/offset/blur radius.
- OSC query of rendered output size (`/text/outputSize`).
- Warnings: missing font (falls back to a default font; saving makes it permanent); invalid size; no video output stage; incomplete video output; licence required.

## 11. Fading video (Fade cues on Video/Camera/Text)
https://qlab.app/docs/v5/video/fading-video/

- A Fade cue targets a Video, Camera or Text cue and changes geometry and effect parameters over a duration. **[Video]**
- Fade cue must have a target, a duration and at least one active parameter.
- Fade inspector shows only the tabs relevant to its target's type.
- Fade can target a patch instead of a cue (target type pop-up). **[Any licence]**
- Curve tab: separate rising curve and falling curve drawn against time and percent complete.
- Curve shape S-Curve (ease-in/ease-out), the default for Fade cues.
- Curve shape Custom Curve: click to add control points, drag to bend smoothly, delete key removes a point.
- Curve shape Parametric Curve with an Intensity value.
- Curve shape Linear Curve: control points make sharp bends.
- Lock button mirrors rising and falling curves; unlocked they can differ (custom/linear).
- "Reset to Default Shape" button.
- Default curve shape comes from the Fade cue template.
- Audio Domain pop-up applies when the target has audio.
- Levels tab appears when the target has audio.
- Geometry tab: per-parameter checkboxes select what the fade changes; unchecked parameters are left alone.
- Per-parameter reset buttons in the Fade's Geometry tab.
- Fade opacity to any whole-number percent 0–100.
- Fade translation X/Y (type values or drag the thumbnail).
- Fade scale X/Y, locked or independent (or scroll on the thumbnail).
- Fade rotation about X, Y, Z.
- 3D orientation fades use quaternions and never pass through more than 180° per axis.
- Single-axis rotation mode: choose an axis and a number of degrees (allows multi-turn spins).
- Preview box shows the stage and a thumbnail of the end state.
- "Set Geometry from Target" (⌃⌥⌘V) pastes the target's current geometry into the fade.
- "Stop Target When Done" checkbox.
- Absolute vs Relative fade pop-up.
- Relative scale and opacity are multiplicative; relative translation and rotation are additive.
- An absolute fade supersedes earlier relative fades.
- Live fade preview toggle button in the tab. **[Free]**
- Curve/Path switch: Path mode fades two parameters along a drawn 2D path.
- Path mode works for translation, rotation and scale only (as of 5.4) and disables the other tabs.
- Path axes default to translation X/Y; Custom assigns any translation/rotation/scale axis to each path axis.
- Path drawn with start (green triangle), end (red square), intermediate points, direction carets, live-position and home markers.
- Path select tool: click a point or drag a selection box; numeric entry for the selected point.
- Path draw tool: click to add points, drag for freehand, ⌥ to insert mid-path, double-click to finish.
- Path circle tool: two clicks define a circle (⌥ for centre + radius).
- Path transforms: flip vertical, flip horizontal, rotate 90°, reverse point order.
- Path help button listing shortcuts and modifiers.
- Canvas origin alignment menu (centre or a corner).
- Canvas width/height fields (default: target's stage size; values are not a limit).
- Merge percentage: target eases from its current position onto the path by that fraction of the fade (shown as a dotted line).
- Smooth path checkbox (curved vs straight between points).
- Loop checkbox: path fade repeats until stopped.
- Canvas zoom (buttons, pinch, ⌥-scroll) and pan.
- "Reset Points" returns the path to the cue-template default.
- Video FX tab of a Fade lists every parameter of every effect on the target, each with a checkbox.
- "Set Video FX from Target" copies the target's current effect values.
- "Fade rate to" fades the playback rate of a Video cue (0.03–33); no effect on Camera or Text cues. **[Video]**
- Audio FX tab appears when the target has audio.
- Revert Fade Action (Tools menu, ⇧⌘R) undoes only what that fade changed.
- Warnings: missing cue target; no parameters set to fade; missing audio effect; licence required.
- Tutorial workspace "Zero to Video" demonstrates fading in/out, scale, rotate and move (https://qlab.app/docs/v5/tutorials/zero-to-video/).

## 12. Video output without a licence
https://qlab.app/docs/v5/video/video-output/

- With no video licence, output is restricted to a single device. **[Free]**
- A "Video output for all cues" pop-up picks that one device (any macOS display).
- Changing that device needs no cue changes; every cue follows it.

## 13. Stages (Workspace Settings → Video → Video Outputs)
https://qlab.app/docs/v5/video/video-output/ , https://qlab.app/docs/v5/fundamentals/workspace-settings/

- A new workspace auto-creates one stage per connected display.
- Any number of stages per workspace. **[Video: unlimited single- and multi-output stages]**
- Stage table columns: Stage Name (editable), Stage Resolution, Devices, Edit, Monitor, delete.
- Stage names must be OSC-safe to be addressed by name over OSC.
- Deleting a stage is undo-able.
- "New Video Stage" button (⌘N when the tab is frontmost) with a creation menu.
- New stage option: Empty Stage (1920 × 1080, no regions, no routes).
- New stage option: Stage with output (sized to and routed to a chosen route).
- New stage option: Stage with partial output (sized to a portion of a route).
- New stage option: Multi-Output Stage… wizard (number of projectors, resolution, arrangement).
- New stage option: Stage with new NDI output….
- New stage option: Stage with new Syphon output….

## 14. Video stage editor: basics and masks
https://qlab.app/docs/v5/video/video-output/

- Stage editor window has a top area plus Layout and Warping tabs.
- Stage name field.
- Stage Layer: stacking order among stages sharing a device area; a higher stage layer beats any cue layer on a lower stage.
- Stages on the same layer are ordered alphabetically.
- "Keep rendering between cues": keeps a black background up until quit or panic, hiding the desktop and smoothing transitions.
- Without it, a black background is drawn only while a cue runs on that stage; the desktop shows otherwise.
- Stage size readout and Resize… with options to keep aspect ratio and to resize regions or not.
- Stage mask: "Load mask…" applies a greyscale image; black hides, white shows. **[Video]**
- Mask uses: non-rectangular stage, feathered vignette, a hole revealing a lower stage.
- Any still format works as a mask; it is converted to greyscale and scaled to fit (mismatched size costs performance).
- No built-in mask editor; the mask file is watched and reloaded live when changed on disk.
- Button to remove the mask.
- Masks and stage geometry apply upstream of Syphon outputs.

## 15. Stage editor: Layout tab and regions
https://qlab.app/docs/v5/video/video-output/

- Region list columns: letter index and colour, thumbnail, output-route pop-up, grid checkbox, delete.
- Drop-down to create a new region on a chosen route.
- Move Regions / Draw Regions switch; drawn regions must then be given a route.
- Region Size fields (type or drag); regions cannot extend outside the stage.
- Region Lower-left coordinate fields relative to stage centre.
- Region Upper-right coordinates shown read-only.
- Edge blend amount per side of a region, with checkboxes. **[Video]**
- Auto edge blends: overlapping regions get an automatic constant-brightness dissolve; uncheck to set blend widths manually.
- Blend gamma field sets the brightness curve of all blends in the stage.
- Edge blends can also soften the edges of a single-region stage.
- Canvas shows regions as coloured rectangles labelled with name and output.
- Drag a region edge to resize, its centre to move.
- Snapping to canvas sides, centrelines and other regions' edges; ⌘ disables snapping.
- Arrow keys move the selected region 1 px; ⇧ 10 px; ⌥ resizes 1 px; ⌥⇧ resizes 10 px.
- Selected region drawn darker; unrouted regions dotted; blend areas hatched.
- Canvas scale pop-up (fit or fixed factor).
- Per-region alignment grid shown on the output.
- Grid options: show all, hide all, export grid as PNG, white-on-black or black-on-white, disable edge blending while the grid shows.
- "Show alignment guides on all output routes used by this stage" (border, centrelines, labels on each route's full raster, unaffected by warping).
- Multiple regions of one stage may use the same route and be positioned and warped independently.
- Regions readable and adjustable over OSC (bounds, moveBy, enableGrid, enableGuide, resetControlPoints).

## 16. Stage editor: Warping tab
https://qlab.app/docs/v5/video/video-output/

- Per-region warping for keystone correction, non-flat surfaces or effect. **[Video]**
- Region Center coordinate fields.
- Selected control point coordinate fields.
- Mesh splits per axis, 1 to 32 in powers of two.
- Reset "Size on Stage" (splits to 1, region matches its Layout size).
- Reset "Size of Route" (splits to 1, region fills its route).
- Canvas shows the route raster with every region on that route; selected region outlined.
- Warping guidelines (default 4 × 4, selectable layout) that never appear in output; points snap to them.
- ⇧ for fine adjustment; ⌘ to disable snapping.
- Drag a control point to warp.
- ⌥-drag a control point to move the whole region.
- Drag inside a region to move it.
- Drag an edge to move the whole edge; drag just inside an edge to move it on one axis only.
- W/A/S/D select the neighbouring control point; arrows nudge 1 px; ⇧ arrows 10 px.
- Warp Type per route: Perspective (default, "continuous perspective").
- Warp Type per route: Linear.
- Warp Type per route: Bézier (sixteen control points per mesh split, for curved surfaces).
- Link / unlink coincident control points of different regions so they move together (drawn as diamonds).
- A region can be placed anywhere in the route raster independent of where it sits on the stage (e.g. right half of the stage shown on the left half of the device).

## 17. Output routes (Workspace Settings → Video → Output Routing)
https://qlab.app/docs/v5/video/video-output/

- A new workspace auto-creates one route per connected device.
- Route table columns: Route Name, Route Resolution, Device (two pop-ups), Guides, Edit, delete (undo-able).
- A route whose device is absent shows the device name in italics with "(missing)".
- Guides checkbox per route: coloured outline, centrelines, corner and centre registration marks, and route name on the full raster.
- "New Output Route" (⌘N): with device; new NDI route…; new Syphon route…; with partial screen device.
- Route editor: route name.
- Route dimensions from 1 × 1 to 30,000 × 30,000 px, with "Set from Device".
- Route rotation in 90° increments.
- Rear projection checkbox (horizontal mirror).
- Scaling mode Center (1:1, cropped or black-bordered).
- Scaling mode Fit (aspect kept, black fill).
- Scaling mode Stretch (independent width/height scaling).
- Scaling mode Fill (aspect kept, cropped).
- Device pop-up in the route editor with the device's dimensions shown.
- Scaling modes let a touring workspace adapt to a venue projector of a different resolution by re-pointing the route.
- Partial outputs: a route can use a portion of a device as if it were a whole device, for splitters (Matrox DualHead/TripleHead/QuadHead2Go, Datapath Fx4/Hx4, AJA HA5-4K) in rows, columns or grids.
- Routes addressable over OSC (list, enableGuides).

## 18. Output devices (Workspace Settings → Video → Output Devices)
https://qlab.app/docs/v5/video/video-output/ , https://qlab.app/docs/v5/fundamentals/workspace-settings/

- Device table columns: name, resolution, info (refresh rate; NDI audio channels), Edit, delete.
- Hardware device names are fixed; NDI and Syphon names are editable.
- "New Virtual Device" (⌘N) creates a Syphon or NDI output.
- Blackmagic outputs: UltraStudio, Intensity and DeckLink devices with outputs; each output of a multi-output device is a separate device. **[Video]**
- Blackmagic device mode pop-up (resolution and frame rate), mirroring Desktop Video Setup.
- Blackmagic device name is read-only in QLab.
- Blackmagic keying: None, External (key + fill on two outputs, frame-synchronised), Internal (QLab output composited over the device's live input in hardware).
- Blackmagic pixel format: BGRA or Y'CbCr (BGRA required for keying).
- NDI outputs: virtual devices with editable name, resolution, frame rate and audio channel count. **[Video]**
- A cue's audio can optionally be sent in the NDI output's audio channels (the NDI device appears as an audio patch device).
- Once used, an NDI output stays active until the workspace closes, even through panic or hard stop.
- Syphon outputs: virtual devices, editable; stay active until the workspace closes. **[Video]**

## 19. Video inputs (Workspace Settings → Video → Video Inputs)
https://qlab.app/docs/v5/fundamentals/workspace-settings/ , https://qlab.app/docs/v5/video/using-ndi/

- Any number of video input patches; a new workspace auto-creates one per connected input device.
- "New Input Patch" (⌘N).
- Patch table columns: Name (OSC-safe for OSC use), Device, Info, Monitor, delete.
- Device pop-up lists inputs by category, including "NDI sources".
- Info shows NDI source IP and port, or a Mode menu (resolution/frame rate) for webcams and Blackmagic devices.
- Patches can be reordered by dragging, duplicated by ⌥-drag, multi-selected with ⇧/⌘.
- Patches can be copied to another workspace by drag, or exported by dragging to Finder.
- NDI 5 supported for video and audio, in and out. **[Video]**
- NDI streams identified as DEVICE_NAME (NDI_SOURCE_NAME).
- NDI network needs: same subnet (or NDI Bridge), multicast, mDNS 5353, TCP 5960, streams from 5961 upward.
- Syphon input supported as a Camera cue source. **[Video]**

## 20. Monitor windows, audition, metrics
https://qlab.app/docs/v5/tools/monitor-windows/ , https://qlab.app/docs/v5/tools/auditioning-cues/ , https://qlab.app/docs/v5/tools/workspace-status-window/

- Video output monitor window: live copy of a stage's output (confidence monitor).
- Video input monitor window: live signal of an input patch without running a Camera cue.
- Monitor windows have a Float checkbox and a Clone button for extra copies.
- Audition for video: leave unchanged, no output, alternate stage, or redirect to an audition window. (Alternate patch for video **[Video]**.)
- Each stage gets its own audition monitor window, opened automatically when needed.
- "Open Audition Windows" button in Workspace Settings → Audition.
- Audition GO (⌥space) and Audition Preview (⌥V); "always audition" toggle (⇧⌘A).
- Workspace Status → Video Metrics tab: actual FPS, target FPS and render time (ms and % of a frame) per stage and device in use.
- Workspace Settings shortcut ⌘3 opens Video settings.
- Performance guidance: Apple Silicon recommended; most Intel Macs not recommended for video; effects and blend modes raise GPU load (https://qlab.app/docs/v5/general/system-recommendations/).
- No video-specific preload feature is described in the Video section beyond normal cue loading.

---

## 21. Lighting: output protocols and hardware
https://qlab.app/docs/v5/lighting/introduction-to-lighting/ , https://qlab.app/docs/v5/general/qlab-preferences/

- Art-Net output over Ethernet or Wi-Fi; QLab speaks Art-Net 3 and works with Art-Net 4 or lower nodes.
- USB-DMX output: Enttec DMX USB Pro and Pro Mk2.
- USB-DMX output: DMXking ultraDMX Micro, ultraDMX RDM Pro, ultraDMX2 Pro, ultraDMX MAX, eDMX1/2/4 MAX.
- USB-DMX output: Yarilo DMX PRO.
- sACN (E1.31) is not mentioned anywhere in the manual.
- QLab does not respond to incoming Art-Net or DMX (output only).
- Preference: Art-Net network interface (Automatic or a specific interface).
- Preference: Art-Net broadcast mode (for nodes without polling, or other Art-Net software on the same Mac).
- Workspace Status → Art-Net tab lists discovered nodes with name, IP and output info (scans when the workspace has an instrument).
- Override Controls window (⇧⌘O) can suspend all Art-Net and USB DMX output, globally across workspaces (https://qlab.app/docs/v5/tools/override-controls/).
- Debug log level 2 covers light command parsing and DMX communication.

## 22. Lighting licence limits
https://qlab.app/docs/v5/general/features/ , https://qlab.app/docs/v5/general/licenses/ , https://qlab.app/docs/v5/lighting/light-patch-editor/

- Without a lighting licence, 16 patchable DMX addresses. **[Free]**
- Instruments beyond the 16 free addresses are marked broken.
- Lighting licence: unlimited patchable addresses (bounded by hardware). **[Lighting]**
- Addressable universes are unlimited at every tier. **[Free]**
- RGB+, CMY and HSI colour pickers are available at every tier. **[Free]**
- Building your own instrument definitions is available at every tier. **[Free]**
- Light cues, the Dashboard, groups, subcontrollers and the command language are not licence-gated beyond the address count.
- Demo mode unlocks all licensed features for 60 minutes in a new workspace; copying cues/settings into it is disabled, and after expiry or save-close-reopen the features need a licence again.

## 23. Light patch (Workspace Settings → Light → Light Patch)
https://qlab.app/docs/v5/lighting/light-patch-editor/ , https://qlab.app/docs/v5/lighting/introduction-to-lighting/

- An instrument represents one physical DMX-controlled thing; it has one or more parameters.
- "New Instrument" (⌘N) popover: how many to create, which definition, and more.
- "New Group" (⌘G) popover: how many, and whether to include the selected instruments.
- "Auto-patch Selected…": choose device and start address, addresses assigned sequentially.
- "Delete Selected" (⌘⌫).
- Patch table sorted alphabetically; disclosure triangles reveal an instrument's parameters or a group's members.
- Status column icons for a broken instrument or one without an address.
- Names unique per workspace; letters, numbers and spaces only (instruments default to numeric names).
- Address column: enter the start address; multi-address instruments take consecutive addresses.
- Conflicting addresses are allowed to be entered but mark the instruments broken.
- Addresses must be unique per universe per device.
- Output column: Art-Net or a USB device, with universe.
- Art-Net addressing by Universe (16), Sub-Net (16) and Net (128); first universe is 0.
- USB devices each have their own universe space starting at 0; multi-universe USB devices take a universe number.
- Output "None" leaves the instrument unpatched; unpatched instruments are hidden from the Dashboard.
- Note column per instrument.
- Hidden-by-default columns Definition and Groups; any column can be shown or hidden via header right-click.
- Mini-inspector under the table duplicating Name, Note, Definition and Output for the selection.
- "Add to Group…" adds selected instruments/groups to a group; groups can contain groups.
- List of groups the selection belongs to.
- Every instrument always belongs to an implicit "all" group.
- Patch menu (replaces Tools): Unpatch All, Unpatch Selected, Auto-patch All…, Auto-patch Selected….
- Patch menu: Select all instruments; Select all unpatched instruments.
- Light patch settings support undo/redo (OSC `/settings/light/undo`, `/redo`).

## 24. Light definitions and the Light Library
https://qlab.app/docs/v5/lighting/light-patch-editor/ , https://qlab.app/docs/v5/lighting/light-library/

- Light Definitions tab lists every definition used in the workspace; definitions are copied into the workspace when first used.
- A workspace embeds its definitions so it is portable between Macs.
- Unused definitions stay in the workspace until removed by hand.
- Buttons: New, Duplicate, Delete (blocked while in use), Save to library, Update from library.
- Filter field; list grouped by manufacturer, alphabetical.
- A definition needs a unique name, a manufacturer and at least one parameter.
- Default parameter pop-up (usually intensity; may be another or none).
- "Add parameter" and "Remove last parameter" buttons; parameter order must follow the fixture's DMX order.
- Parameter name: unique per instrument, letters/numbers/spaces.
- Parameter 16-bit checkbox (two adjacent addresses, 0–65,535).
- Parameter "Use %" checkbox (display as percentage instead of 0–255).
- Parameter Home value (e.g. dimmer 0%, iris 100%, mirror 50%).
- Virtual parameter RGB Color: R, G, B plus optional extras (white, amber, lime…); several per fixture for multi-cell lights.
- Virtual parameter CMY Color.
- Virtual parameter HSI Color (hue, saturation, intensity/value).
- Virtual parameter Pan/Tilt.
- Virtual parameter One-to-Many: one control drives several parameters (may include other virtual parameters).
- Global Light Library window (Window menu) edits the Mac-wide collection the same way.
- User definitions stored as JSON `.qlablight` files in `~/Library/Application Support/QLab/LightLibrary`.
- Double-clicking a `.qlablight` file offers import to the front workspace or the global library (5.6+).
- Stock generic definitions: Dimmer; DMX Iris (8/16-bit); RGB, RGBW, RGBAW fixtures with or without intensity (8/16-bit); Scroller; Variable white with intensity (8/16-bit).
- Stock library covers roughly seventy manufacturers (Acme, ADJ, ARRI, Astera, Ayrton, Chauvet, Clay Paky, Elation, ETC, GLP, High End, Martin, Robe, Vari-Lite and others), and also lists projector makers (Barco, Christie, Epson, Panasonic) and fog-machine makers (Froggy's Fog, Ultratec).
- Figure 53 will write definitions on request.

## 25. Light cues
https://qlab.app/docs/v5/lighting/light-cues/ , https://qlab.app/docs/v5/lighting/introduction-to-lighting/

- A Light cue stores light commands and applies them over a duration with a curve; it has no target.
- A cue may hold one parameter, several, or every parameter of every light.
- Tracking by omission: an instrument not in a cue gets no level and keeps whatever it had; running order matters.
- "Originating cue" concept: the cue that last set each instrument's current level.
- Levels tab has a lighting command line for typing commands into the cue.
- "Add Command" pop-up lists all instruments and groups; ones already in the cue are greyed out.
- "Safe Sort Commands": alphabetical sort that leaves any command whose move would change the result.
- Commands are interpreted top to bottom.
- Slider view: one command per row with a slider and text field; a yellow mark shows the current live value.
- Slider view: drag rows to reorder; remove button per command.
- Slider view: commands can be cut, copied and pasted.
- Colour and pan/tilt virtual parameters show their picker beside the list instead of a slider.
- Editing a cue in the inspector is blind: nothing changes on stage until the cue runs.
- Tile view: tiles with brightness-coded outlines; type or drag on a tile; rows selectable; hover to delete; no reordering.
- Text view: the cue's commands as plain editable text.
- View pop-up (sliders, tiles, text) changes only the display.
- "Collate effects of previous light cues" checkbox: the cue behaves as if all prior Light cues in the list had run (console-style, order-independent).
- OSC `collateAndStart` runs a cue collated on demand.
- "Use as subcontroller in dashboard" checkbox.
- Buttons to open the Light Patch and the Dashboard.
- "Expand" button on a pulled command copies the pulled level in and breaks the link.
- Prune (OSC) removes commands that have no effect.
- Curve tab: one curve for rising levels and one for falling levels.
- Curve types: Custom (default), Linear, S-Curve, Parametric (with Intensity).
- Duration field in the Curve tab (same as Basics/cue list duration); "Reset to Default Shape".
- A Light cue has a single fade time for all its parameters (no per-parameter or split up/down times are documented, only separate up/down curve shapes).
- Light cues can be auditioned to the Dashboard's Audition tab.
- Light commands editable over OSC (`setLight`, `lightCommandText`, `replaceLightCommand`, `removeLightCommandsMatching`).
- Warnings: invalid light command (visible only in text view); no instrument in the cue is patched; broken light definition; missing USB DMX device.

## 26. Lighting command language
https://qlab.app/docs/v5/lighting/lighting-command-language/

- Every Light cue is a block of text in this language.
- Forms: `instrument = value`, `instrument.parameter = value`, `group = value`, `group.parameter = value`.
- Spaces are optional.
- Omitting the parameter addresses the definition's default parameter.
- A group.parameter command reaches only members that have that parameter.
- Values may be percentages or raw DMX depending on the parameter's definition.
- Decimal percentages accepted and rounded to the nearest DMX step.
- `pass` leaves an instrument or group unchanged by this cue (to carve an exception out of a group command).
- `home` sets an instrument or parameter to its home value.
- Up arrow recalls command history and keeps the selection, so only a new value needs typing.
- Ranges: `1 - 3 = 50` and lists `10, 12, 14 = 75`, expanded into individual commands.
- Ad-hoc groups: `[1 - 3] = 50` stays one command and behaves like a group.
- Pull from cue: `10 = cue A` takes the level(s) from another cue at run time (palette/preset equivalent).
- Pull a single parameter: `10.zoom = cue A`.
- Pull a whole group, then override members with later commands.
- Pulled values follow later edits to the source cue.
- Proportional pull: `10 = cue A * .5`.
- Virtual-parameter values such as `pantilt(20,30)` are accepted (OSC example).
- There are no dedicated palette, preset or effect-engine objects; pull-from-cue is the only palette mechanism described.

## 27. Light Dashboard: live control
https://qlab.app/docs/v5/lighting/light-dashboard/

- Dashboard opens from the Window menu or ⇧⌘D; two tabs, Live and Audition.
- Live tab shows current levels of all instruments and sends edits to hardware immediately.
- Running a Light cue animates the Dashboard as levels change.
- Levels editable by command line, dragging sliders/tiles, typing in fields, or dragging on fields.
- Command line across the top using the same command language.
- "Over Time" field fades the next command over a time (sneak); resets to 0 after each use.
- All / Used pop-up: every patched instrument and group, or only those recorded in cues or manually changed.
- Slider view: one instrument or group per row, alphabetical, field plus slider.
- Shift-click several sliders to drag them together.
- Dragged sliders and tiles snap to whole numbers; decimals by typing or dragging the field.
- More decimal places shown for 16-bit parameters; ⇧ while dragging for finer steps.
- Manually modified controls turn yellow; slider handle becomes a triangle pointing the way it last moved.
- Group rows show marks for members sitting at different levels.
- Disclosure triangle unfolds a multi-parameter instrument or group to all its parameters.
- A group exposes every parameter of every member.
- Tile view: a tile per parameter, grouped into light groups, simple instruments and multi-parameter instruments; outline brightness shows level; modified tiles yellow.
- Sidebar virtual controls appear for the selected instrument.
- Additive colour picker: triangle with draggable pip, a slider per emitter, and a % master that scales all components.
- Extra emitters (amber, white, lime, indigo…) get sliders and reshade the triangle.
- Subtractive (CMY) colour picker.
- HSI picker (circular) with intensity tied to the instrument's intensity parameter.
- Pan/tilt XY pad with 10% gridlines.
- Right-click the sidebar to show sliders for the default and all other parameters of the selection.
- "Latest Light cue" readout names the most recently run Light cue.
- Revert Changes (⌘R) restores manual changes to their last cue-set levels over the workspace panic duration.
- Undo and redo of individual Dashboard changes.
- Clear All sets every parameter to home ("go to cue out"; usually a blackout); parked parameters unaffected.
- DMX Status Window (Window menu): one universe at a time, shows live values and lets you set addresses by hand; changes cannot be recorded.

## 28. Light Dashboard: recording, updating, parking, subcontrollers, audition
https://qlab.app/docs/v5/lighting/light-dashboard/

- New cues from the Dashboard land after the selected cue, or at the end of the current list/cart.
- Record All → Latest Cue: overwrite the latest cue with every current level.
- Record All → Selected Cue(s).
- Record All → New Cue: every parameter recorded, untouched ones at home (a blocking cue).
- New Cue with All button (⇧⌘N), same as Record All → New Cue.
- New Cue with Changes (⌘N): records only manually modified levels (a tracking cue).
- Update is enabled only when there are modified (yellow) values.
- Update → Latest Cue (⌘U): merge modified levels into the latest cue.
- Update → Selected Cue(s) (⇧⌘U).
- Update → Originating Cue(s) (⌥⌘U): write each modified level back into the cue that originated it (record-track); the button states how many cues will change.
- Tools menu is replaced with these Dashboard commands while the Dashboard is frontmost.
- Park Selected Lights / Unpark Selected Lights: freeze an instrument, group or individual parameters at the current output.
- Parked values ignore cues and the Dashboard and cannot be recorded; parked controls are drawn striped with a mark at the parked value.
- Unparking snaps output to the current value; both park and unpark ask for confirmation.
- ⌘-click selects several sliders to park together.
- Subcontroller: a numbered Light cue flagged as a subcontroller appears as a Dashboard slider scaling its recorded parameters proportionally.
- Subcontrollers combine with cues by highest-takes-precedence (HTP).
- Everything else in the Dashboard is latest-takes-precedence (LTP).
- Audition tab: auditioned Light cues run here with no DMX output (blind), dark blue background.
- Audition tab has "Reset from Live" in place of Clear All; other buttons behave the same.
- Audition setting for light: leave unchanged or redirect to the Audition tab (no "no output" or alternate patch for light).
- Dashboard controllable over OSC: setLight with optional fade time, clear, revert, undo/redo, view mode, new cue with all/changes, record all to latest/selected, update latest/selected/originating.

## 29. Light Dashboard MIDI control
https://qlab.app/docs/v5/fundamentals/workspace-settings/ (Light → Light Dashboard MIDI)

- MIDI messages can be mapped to instrument and group parameters in the Dashboard (control-surface faders).
- Light MIDI Channel: follow workspace channel, a fixed channel, or any.
- "Send MIDI feedback" to a chosen device so motorised faders follow.
- Light Command table has a row per instrument and group, expandable to parameters, kept up to date with the patch.
- Special row "subcontrollers" for mapping subcontroller sliders.
- Special row "selected": mapped controls act on whatever is selected in the Dashboard.
- Mapping to an instrument or group row drives its default parameter.
- Binding by manual entry or Capture (learn the next incoming message).
- Command Filter field to find an instrument or group.
- Workspace Settings shortcut ⌘6 opens Light settings.
- No encoder-specific (relative) behaviour or lighting keyboard command syntax beyond the above is documented.
