import cors from "cors";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.resolve(__dirname, "static");
app.use(express.static(staticDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  socket.on("join", (payload: unknown) => {
    const role = typeof payload === "object" && payload && "role" in payload ? (payload as { role?: string }).role : "";
    const roomId =
      typeof payload === "object" && payload && "roomId" in payload ? (payload as { roomId?: string }).roomId : "default-room";
    const safeRoom = roomId || "default-room";
    socket.join(safeRoom);
    socket.emit("joined", { role, roomId: safeRoom });
  });

  socket.on("mobileInput", (payload: unknown) => {
    const roomId =
      typeof payload === "object" && payload && "roomId" in payload ? (payload as { roomId?: string }).roomId : "default-room";
    const safeRoom = roomId || "default-room";
    socket.to(safeRoom).emit("mobileInput", payload);
  });
});

const port = 5174;
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Controller server running on http://0.0.0.0:${port}`);
});
