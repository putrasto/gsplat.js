Usage:
  bun install                                                                               
  bun run dev        # starts both Hono (port 3001) and Vite (port 5173)                    
  bun run build      # type-check + build for production                                    
  bun run start      # serve production build from port 3001      

in server:
HOST=0.0.0.0 PORT=3010 MAX_REQUEST_BODY_SIZE=2147483648 bun run start  

Renderer notes (PlayCanvas):
  - The viewer now uses PlayCanvas GSplat rendering (SH-capable).
  - To keep output sharp (avoid blur), keep these settings in `src/main.ts`:
      app.setCanvasFillMode(pc.FILLMODE_NONE)
      app.setCanvasResolution(pc.RESOLUTION_AUTO)
      app.graphicsDevice.maxPixelRatio = window.devicePixelRatio
  - In resize handling, call `app.resizeCanvas(viewer.clientWidth, viewer.clientHeight)`.
    Do not pre-multiply width/height by DPR before calling `resizeCanvas`.
