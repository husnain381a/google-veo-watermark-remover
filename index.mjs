import express from "express";
import cors from "cors";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Ensure folders exist (Railway-safe)
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("outputs")) fs.mkdirSync("outputs");

// Health check
app.get("/", (req, res) => {
  res.json({ status: "OK", message: "Watermark backend is running 🚀" });
});

// Multer setup
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (_, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

// Video processing
app.post("/process-video", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No video uploaded" });
  }

  const inputPath = req.file.path;
  const outputPath = `outputs/clean-${Date.now()}.mp4`;

  console.log("🎬 Processing:", inputPath);

  ffmpeg(inputPath)
    // Placeholder watermark logic
    .videoFilters("crop=in_w-200:in_h-100:0:0")
    .outputOptions("-movflags faststart")
    .on("end", () => {
      console.log("✅ Processing finished");

      res.download(outputPath, "clean.mp4", () => {
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
      });
    })
    .on("error", (err) => {
      console.error("❌ FFmpeg error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Video processing failed" });
      }
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    })
    .save(outputPath);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
