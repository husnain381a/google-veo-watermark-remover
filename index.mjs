import express from "express";
import cors from "cors";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ==========================================
// SETUP & DIRECTORIES
// ==========================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set FFmpeg binary path
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const UPLOAD_DIR = process.env.RAILWAY_ENVIRONMENT ? "/tmp/uploads" : "./uploads";
const OUTPUT_DIR = process.env.RAILWAY_ENVIRONMENT ? "/tmp/outputs" : "./outputs";

// Ensure directories exist
[UPLOAD_DIR, OUTPUT_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ==========================================
// MULTER CONFIG
// ==========================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_, file, cb) => {
    // Sanitize filename to prevent issues with special characters
    const safeName = Date.now() + "-" + file.originalname.replace(/[^a-zA-Z0-9.]/g, "_");
    cb(null, safeName);
  },
});

const upload = multer({ 
  storage,
  limits: { 
    fileSize: 50 * 1024 * 1024 // 50MB Limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed!"), false);
    }
  }
});

// ==========================================
// PROCESS ROUTE
// ==========================================
app.post("/process-video", upload.single("video"), (req, res) => {
  
  if (!req.file) {
    return res.status(400).json({ error: "No video uploaded" });
  }

  const inputPath = req.file.path;
  const outputFilename = `clean-${Date.now()}.mp4`;
  const outputPath = path.join(OUTPUT_DIR, outputFilename);

  console.log(`Processing: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

  ffmpeg(inputPath)
    .videoFilters([
        "scale='min(1280,iw)':-2", 
        "crop=in_w-200:in_h-100:0:0"
    ])
    .outputOptions([
        "-threads 1",                  
        "-preset ultrafast",          
        "-max_muxing_queue_size 256",  
        "-crf 28",                     
        "-movflags faststart"         
    ])
    .on("start", (cmd) => {
        console.log("Spawned FFmpeg with RAM optimization");
    })
    .on("end", () => {
      console.log("Processing finished successfully.");
      
      res.download(outputPath, "clean.mp4", (err) => {
        if (err && !res.headersSent) {
             console.error("Download Error:", err);
             res.status(500).send("Error downloading file");
        }
        cleanupFiles([inputPath, outputPath]);
      });
    })
    .on("error", (err, stdout, stderr) => {
      console.error(`FFmpeg Error: ${err.message}`);
      
      // Check for Memory limit errors
      if (err.message.includes("SIGKILL") || err.message.includes("137")) {
          console.error("CRITICAL: Process killed by Railway Memory Limit.");
      }

      cleanupFiles([inputPath, outputPath]);

      if (!res.headersSent) {
        res.status(500).json({ 
            error: "Processing Failed", 
            details: "The server is busy or the video is too complex. Try a smaller file." 
        });
      }
    })
    .save(outputPath);
});

// ==========================================
// GLOBAL ERROR HANDLER
// ==========================================
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

  console.error("Server Error:", err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Helper for cleaning up files
function cleanupFiles(paths) {
  paths.forEach((p) => {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (e) { 
        // Ignore unlink errors (file might already be gone)
    }
  });
}

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.RAILWAY_ENVIRONMENT ? "Railway" : "Local"}`);
});