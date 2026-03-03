Usage:
  bun install                                                                               
  bun run dev        # starts both Hono (port 3001) and Vite (port 5173)                    
  bun run build      # type-check + build for production                                    
  bun run start      # serve production build from port 3001      

in server:
HOST=0.0.0.0 PORT=3010 MAX_REQUEST_BODY_SIZE=2147483648 bun run start  