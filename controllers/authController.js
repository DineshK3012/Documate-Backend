import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import validator from "validator";
import crypto from "crypto";
import userModel from "../models/userModel.js";
import passwordResetModel from "../models/passwordResetModel.js";
import { sendPasswordResetEmail } from "../config/nodemailer.js";
import { verifyGoogleToken } from "../config/googleAuth.js";

// API for forgot password
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        // Validate email
        if (!email) {
            return res.json({ success: false, message: "Email is required" });
        }

        if (!validator.isEmail(email)) {
            return res.json({ success: false, message: "Please enter a valid email" });
        }

        // Check if user exists
        const user = await userModel.findOne({ email });
        if (!user) {
            return res.json({ success: false, message: "User with this email does not exist" });
        }

        // Delete any existing reset tokens for this user
        await passwordResetModel.deleteMany({ userId: user._id });

        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        
        // Save reset token to database
        const passwordReset = new passwordResetModel({
            userId: user._id,
            email: user.email,
            token: resetToken
        });
        
        await passwordReset.save();

        // Send reset email
        const emailResult = await sendPasswordResetEmail(email, resetToken, user.name);
        
        if (emailResult.success) {
            res.json({ 
                success: true, 
                message: "Password reset link has been sent to your email" 
            });
        } else {
            // Clean up the token if email failed
            await passwordResetModel.deleteOne({ token: resetToken });
            res.json({ 
                success: false, 
                message: "Failed to send email. Please try again later." 
            });
        }

    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
};

// API to verify reset token
const verifyResetToken = async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.json({ success: false, message: "Reset token is required" });
        }

        // Find the reset token
        const resetRecord = await passwordResetModel.findOne({ token });
        
        if (!resetRecord) {
            return res.json({ 
                success: false, 
                message: "Invalid or expired reset token" 
            });
        }

        // Check if user still exists
        const user = await userModel.findById(resetRecord.userId);
        if (!user) {
            return res.json({ success: false, message: "User not found" });
        }

        res.json({ 
            success: true, 
            message: "Token is valid",
            email: resetRecord.email 
        });

    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
};

// API to reset password
const resetPassword = async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        // Validate inputs
        if (!token || !newPassword) {
            return res.json({ 
                success: false, 
                message: "Token and new password are required" 
            });
        }

        if (newPassword.length < 8) {
            return res.json({ 
                success: false, 
                message: "Password must be at least 8 characters long" 
            });
        }

        // Find the reset token
        const resetRecord = await passwordResetModel.findOne({ token });
        
        if (!resetRecord) {
            return res.json({ 
                success: false, 
                message: "Invalid or expired reset token" 
            });
        }

        // Find the user
        const user = await userModel.findById(resetRecord.userId);
        if (!user) {
            return res.json({ success: false, message: "User not found" });
        }

        // Hash the new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update user password
        await userModel.findByIdAndUpdate(user._id, { password: hashedPassword });

        // Delete the used reset token
        await passwordResetModel.deleteOne({ token });

        res.json({ 
            success: true, 
            message: "Password has been reset successfully" 
        });

    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
};

// API for Google authentication
const googleAuth = async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.json({ success: false, message: "Google token is required" });
        }

        // Verify Google token
        const verificationResult = await verifyGoogleToken(token);
        
        if (!verificationResult.success) {
            return res.json({ 
                success: false, 
                message: "Invalid Google token" 
            });
        }

        const { user: googleUser } = verificationResult;

        // Check if user already exists
        let user = await userModel.findOne({ email: googleUser.email });

        if (user) {
            // User exists, update Google info if needed
            if (!user.googleId) {
                await userModel.findByIdAndUpdate(user._id, { 
                    googleId: googleUser.googleId,
                    image: googleUser.picture || user.image
                });
            }
        } else {
            // Create new user
            const userData = {
                name: googleUser.name,
                email: googleUser.email,
                googleId: googleUser.googleId,
                image: googleUser.picture || 'data:image/png;base64,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',
                password: crypto.randomBytes(16).toString('hex') // Random password for Google users
            };

            user = new userModel(userData);
            await user.save();
        }

        // Generate JWT token
        const jwtToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET);

        res.json({ 
            success: true, 
            token: jwtToken,
            message: "Google authentication successful"
        });

    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
};

export {
    forgotPassword,
    verifyResetToken,
    resetPassword,
    googleAuth
};