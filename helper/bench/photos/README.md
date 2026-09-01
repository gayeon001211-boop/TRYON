Drop real glasses photos here (jpg/png) — product shots and worn-on-a-face both.

Then, with the helper running:

    npm run helper          # in another terminal
    node bench_seg.mjs      # reads this folder

Optional, per photo: a sidecar `<name>.points.json` with the prompt points, so a photo
with a face is prompted the way the app would prompt it instead of with the blind band:

    [{"p": [412, 300], "label": 1}, {"p": [500, 300], "label": 0}]

Nothing here is committed except this file.
