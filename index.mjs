import express from "express";
import cors from "cors";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ==========================================
// 🔧 SETUP & DIRECTORIES
// ==========================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tell fluent-ffmpeg to use the static binary
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Railway / Read-only system support
const UPLOAD_DIR = process.env.RAILWAY_ENVIRONMENT ? "/tmp/uploads" : "./uploads";
const OUTPUT_DIR = process.env.RAILWAY_ENVIRONMENT ? "/tmp/outputs" : "./outputs";

// Ensure directories exist
[UPLOAD_DIR, OUTPUT_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ==========================================
// 📂 MULTER CONFIG (SECURED)
// ==========================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_, file, cb) => {
    // Robust sanitization: removes special chars and spaces
    const safeName = Date.now() + "-" + file.originalname.replace(/[^a-zA-Z0-9.]/g, "_");
    cb(null, safeName);
  },
});

const upload = multer({ 
  storage,
  // 1. LIMIT FILE SIZE (50MB)
  limits: { 
    fileSize: 50 * 1024 * 1024 // 50 MB in bytes
  },
  // 2. FILTER FILE TYPES
  fileFilter: (req, file, cb) => {
    // Accept only video files (mp4, mkv, mov, etc.)
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed!"), false);
    }
  }
});

// ==========================================
// 🚀 PROCESS ROUTE
// ==========================================
// Note: We use upload.single('video') here. 
// If it fails validation, the error is passed to the Global Error Handler below.
app.post("/process-video", upload.single("video"), (req, res) => {
  
  // Safety check (in case fileFilter passes but file is missing)
  if (!req.file) {
    return res.status(400).json({ error: "No video uploaded" });
  }

  const inputPath = req.file.path;
  const outputFilename = `clean-${Date.now()}.mp4`;
  const outputPath = path.join(OUTPUT_DIR, outputFilename);

  console.log(`🎬 Processing: ${req.file.originalname}`);

  ffmpeg(inputPath)
    .videoFilters("crop=in_w-200:in_h-100:0:0") // Crop Logic
    .outputOptions("-movflags faststart")
    .on("start", (cmd) => console.log("Spawned FFmpeg"))
    .on("end", () => {
      console.log("✅ Processing finished. Sending file...");

      res.download(outputPath, "clean.mp4", (err) => {
        if (err && !res.headersSent) {
             console.error("Download Error:", err);
             res.status(500).send("Error downloading file");
        }
        // CLEANUP
        cleanupFiles([inputPath, outputPath]);
      });
    })
    .on("error", (err, stdout, stderr) => {
      console.error("❌ FFmpeg Failed:", err.message);
      cleanupFiles([inputPath, outputPath]); // Delete inputs on failure

      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Video processing failed", 
          details: err.message 
        });
      }
    })
    .save(outputPath);
});

// ==========================================
// 🛡️ GLOBAL ERROR HANDLER
// ==========================================
// This handles Multer errors (File too large, Wrong type)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ 
        error: "File too large", 
        message: "File exceeds the 50MB limit." 
      });
    }
  }
  
  if (err.message === "Only video files are allowed!") {
    return res.status(400).json({ error: "Invalid file type. Please upload a video." });
  }

  // Default error handler
  console.error("Server Error:", err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Helper for cleaning up files safely
function cleanupFiles(paths) {
  paths.forEach((p) => {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (e) { console.error(`Failed to delete ${p}`, e); }
  });
}

// ==========================================
// 🏁 START SERVER
// ==========================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🛡️ Max Upload Size: 50MB`);
});