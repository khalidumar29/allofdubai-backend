import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import nodemailer from "nodemailer";
import crypto from "crypto";
import mysql from "mysql2/promise";
import multer from "multer";
import path from "path";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const port = process.env.PORT || 0;

app.use(
  cors({
    origin: "*",
  })
);
app.use(bodyParser.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// MySQL Connection Pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Configure Nodemailer
const transporter = nodemailer.createTransport({
  host: "mail.allofdubai.com", // Replace with your email service
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// @ts-ignore
app.post("/send-otp", async (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  // Generate OTP
  const otp = crypto.randomInt(100000, 999999).toString();
  const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity

  try {
    // Store OTP in MySQL
    const connection = await pool.getConnection();
    await connection.execute(
      `INSERT INTO otps (email, otp, expiry) VALUES (?, ?, ?)`,
      [email, otp, expiry]
    );
    connection.release();

    // Send OTP via email
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Your OTP Code",
      text: `Your OTP code is ${otp}. It will expire in 5 minutes.`,
    });

    res.status(200).json({ message: "OTP sent successfully" });
  } catch (error) {
    console.error("Error sending OTP:", error);
    res.status(500).json({ message: "Failed to send OTP" });
  }
});

// Configure Multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Limit file size to 5MB
  fileFilter: (req, file, cb) => {
    const fileTypes = /jpeg|jpg|png|gif/;
    const extname = fileTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = fileTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only images are allowed"));
    }
  },
});

app.post(
  "/submit-form",
  upload.array("images", 5),
  // @ts-ignore
  async (req: Request, res: Response) => {
    const { name, email, otp, category, additionalInfo } = req.body;

    if (!name || !email || !otp) {
      return res
        .status(400)
        .json({ message: "Name, email, and OTP are required" });
    }

    const connection = await pool.getConnection();
    try {
      // Retrieve OTP from MySQL
      const [rows] = await connection.execute(
        `SELECT otp, expiry FROM otps WHERE email = ? ORDER BY created_at DESC LIMIT 1`,
        [email]
      );

      const otpRecord = (rows as any[])[0];

      if (!otpRecord) {
        return res
          .status(400)
          .json({ message: "No OTP request found for this email" });
      }

      if (new Date() > new Date(otpRecord.expiry)) {
        return res.status(400).json({ message: "OTP has expired" });
      }

      if (otpRecord.otp !== otp) {
        return res.status(400).json({ message: "Invalid OTP" });
      }

      // Delete OTP after successful verification
      await connection.execute(`DELETE FROM otps WHERE email = ?`, [email]);

      // Insert form data into the submissions table
      const [result] = await connection.execute(
        `INSERT INTO submissions (name, email, category, additional_info) VALUES (?, ?, ?, ?)`,
        [name, email, category, additionalInfo]
      );

      const submissionId = (result as any).insertId;

      // Handle file uploads
      const fileLinks: string[] = [];
      if (req.files) {
        const files = req.files as Express.Multer.File[];
        for (const file of files) {
          const fileLink = `${req.protocol}://${req.get("host")}/uploads/${
            file.filename
          }`;
          fileLinks.push(fileLink);

          // Save each file link in the submission_images table
          await connection.execute(
            `INSERT INTO submission_images (submission_id, image_url) VALUES (?, ?)`,
            [submissionId, fileLink]
          );
        }
      }

      // Send email to admin attach info and image
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: "khalid100umar@gmail.com, vatandoust.rvi@gmail.com",
        subject: "New Form Submission",
        text: `A new form has been submitted by ${name}. Category: ${category}. Additional Info: ${additionalInfo}`,
        // @ts-ignore
        attachments: req.files?.map((file) => ({
          filename: file.originalname,
          path: file.path,
        })),
      });

      res.status(200).json({
        message: "Form submitted successfully!",
        images: fileLinks,
      });
    } catch (error) {
      console.error("Error processing form submission:", error);
      res
        .status(500)
        .json({ message: "An error occurred while submitting the form" });
    } finally {
      connection.release();
    }
  }
);
app.get("/", (req, res) => {
  res.send("Hello World");
});
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
