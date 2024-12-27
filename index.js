"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const crypto_1 = __importDefault(require("crypto"));
const promise_1 = __importDefault(require("mysql2/promise"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 0;
app.use((0, cors_1.default)({
    origin: "*",
}));
app.use(body_parser_1.default.json());
app.use("/uploads", express_1.default.static(path_1.default.join(__dirname, "uploads")));
// MySQL Connection Pool
const pool = promise_1.default.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});
// Configure Nodemailer
const transporter = nodemailer_1.default.createTransport({
    host: "mail.allofdubai.com", // Replace with your email service
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});
// @ts-ignore
app.post("/send-otp", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ message: "Email is required" });
    }
    // Generate OTP
    const otp = crypto_1.default.randomInt(100000, 999999).toString();
    const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity
    try {
        // Store OTP in MySQL
        const connection = yield pool.getConnection();
        yield connection.execute(`INSERT INTO otps (email, otp, expiry) VALUES (?, ?, ?)`, [email, otp, expiry]);
        connection.release();
        // Send OTP via email
        yield transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Your OTP Code",
            text: `Your OTP code is ${otp}. It will expire in 5 minutes.`,
        });
        res.status(200).json({ message: "OTP sent successfully" });
    }
    catch (error) {
        console.error("Error sending OTP:", error);
        res.status(500).json({ message: "Failed to send OTP" });
    }
}));
// Configure Multer for image uploads
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${file.originalname}`;
        cb(null, uniqueName);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Limit file size to 5MB
    fileFilter: (req, file, cb) => {
        const fileTypes = /jpeg|jpg|png|gif/;
        const extname = fileTypes.test(path_1.default.extname(file.originalname).toLowerCase());
        const mimetype = fileTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        else {
            cb(new Error("Only images are allowed"));
        }
    },
});
app.post("/submit-form", upload.array("images", 5), 
// @ts-ignore
(req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { name, email, otp, category, additionalInfo } = req.body;
    if (!name || !email || !otp) {
        return res
            .status(400)
            .json({ message: "Name, email, and OTP are required" });
    }
    const connection = yield pool.getConnection();
    try {
        // Retrieve OTP from MySQL
        const [rows] = yield connection.execute(`SELECT otp, expiry FROM otps WHERE email = ? ORDER BY created_at DESC LIMIT 1`, [email]);
        const otpRecord = rows[0];
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
        yield connection.execute(`DELETE FROM otps WHERE email = ?`, [email]);
        // Insert form data into the submissions table
        const [result] = yield connection.execute(`INSERT INTO submissions (name, email, category, additional_info) VALUES (?, ?, ?, ?)`, [name, email, category, additionalInfo]);
        const submissionId = result.insertId;
        // Handle file uploads
        const fileLinks = [];
        if (req.files) {
            const files = req.files;
            for (const file of files) {
                const fileLink = `${req.protocol}://${req.get("host")}/uploads/${file.filename}`;
                fileLinks.push(fileLink);
                // Save each file link in the submission_images table
                yield connection.execute(`INSERT INTO submission_images (submission_id, image_url) VALUES (?, ?)`, [submissionId, fileLink]);
            }
        }
        // Send email to admin attach info and image
        yield transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: "khalid100umar@gmail.com, vatandoust.rvi@gmail.com",
            subject: "New Form Submission",
            text: `A new form has been submitted by ${name}. Category: ${category}. Additional Info: ${additionalInfo}`,
            // @ts-ignore
            attachments: (_a = req.files) === null || _a === void 0 ? void 0 : _a.map((file) => ({
                filename: file.originalname,
                path: file.path,
            })),
        });
        res.status(200).json({
            message: "Form submitted successfully!",
            images: fileLinks,
        });
    }
    catch (error) {
        console.error("Error processing form submission:", error);
        res
            .status(500)
            .json({ message: "An error occurred while submitting the form" });
    }
    finally {
        connection.release();
    }
}));
app.get("/", (req, res) => {
    res.send("Hello World");
});
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
