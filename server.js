require('dotenv').config()
const express = require("express")
const http = require('http')
const cors = require('cors')
const { Users, Profile, Message, Notification, Connected } = require('./db')
const { Server } = require('socket.io')
const multer = require('multer')
const path = require('path')
const fs = require("fs")
const nodemailer = require('nodemailer')
const { createClient } = require("@supabase/supabase-js")

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }))
const usersOnline = new Set();
const lastSeen = {};

//Initialized supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

//Multer config (store files in memory instead of disk)
const upload = multer({ storage: multer.memoryStorage() })

//Create Http + websocket server
const server = http.createServer(app)
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
})

//Add user
app.post("/user", async (req, res) => {
    const user = new Users(req.body);
    await user.save();
    res.send(user);
});

//Get list of all users
app.get("/users", async (req, res) => {
    const users = await Users.find();
    res.send(users)
})

//Search users by skills
app.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        let users;
        if (!q || q.trim() === "") {
            //if no query return all users
            users = await Profile.find({})
        } else {
            //Case-sensitive search in both skillHave and skillWant
            users = await Profile.find({
                $or: [
                    { skillHave: { $regex: q, $options: "i" } },
                    { skillWant: { $regex: q, $options: 'i' } }
                ]
            })
        }
        res.json(users)
    } catch (error) {
        console.error(error);
    }
})

//Update profile
app.post('/profile', async (req, res) => {
    try {
        const { userId, skillHave, skillWant, removeSkillHave, removeSkillWant, ...rest } = req.body;

        //Step 1. Update general profile fields
        let profile = await Profile.findOneAndUpdate(
            { userId },
            { $set: rest },
            { new: true, upsert: true }
        );

        //Step 2. Add to skillHave
        if (skillHave && skillHave.length > 0) {
            profile = await Profile.findOneAndUpdate(
                { userId },
                { $addToSet: { skillHave: { $each: skillHave } } },
                { new: true }
            )
        }

        //Step 3: Add to skill want
        if (skillWant && skillWant.length > 0) {
            profile = await Profile.findOneAndUpdate(
                { userId },
                { $addToSet: { skillWant: { $each: skillWant } } },
                { new: true }
            )
        }

        //Step 4. Remove from skillHave
        if (removeSkillHave && removeSkillHave.length > 0) {
            profile = await Profile.findOneAndUpdate(
                { userId },
                { $pull: { skillHave: { $in: removeSkillHave } } },
                { new: true }
            )
        }

        //Step 5: Remove from skill want
        if (removeSkillWant && removeSkillWant.length > 0) {
            profile = await Profile.findOneAndUpdate(
                { userId },
                { $pull: { skillWant: { $in: removeSkillWant } } },
                { new: true }
            )
        }

        res.send(profile)
    } catch (error) {
        console.error(error)
    }
})

//Update social links
app.post('/update-social', async (req, res) => {
    try {
        const { userId, social } = req.body;
        const profile = await Profile.findOneAndUpdate(
            { userId },
            { $set: { social } },
            { new: true, upsert: true }
        )
        res.send(profile)

    } catch (error) {
        console.log(error)
    }
})

//get profile details
app.get('/get-profiles', async (req, res) => {
    try {
        let users = await Profile.find();

        //filter social links (remove empty ones)
        users = users.map(user => {
            const userObj = user.toObject();

            if (userObj.social) {
                Object.keys(userObj.social).forEach(key => {
                    if (!userObj.social[key]) {
                        delete userObj.social[key]; //remove blank links
                    }
                })
            }

            return userObj;
        })
        res.send(users)
    } catch (error) {
        console.error(error)
    }
})

// get profile for current user
app.post('/get-profile', async (req, res) => {
    const { userId } = req.body;
    const profile = await Profile.find({ userId: userId })
    res.send(profile);
})

//Join personal room by userId
io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Join personal room by userId
    socket.on("join", (userId) => {
        socket.join(userId);
        socket.userId = userId; // keep track of who this socket belongs to
        usersOnline.add(userId)
        io.emit("onlineUsers", {
            online: Array.from(usersOnline),
            lastSeen
        })
        console.log(`✅ User ${userId} joined their room.`);
    });

    // Send message
    socket.on("sendMessage", async ({ senderId, receiverId, text }) => {
        const chatId = [senderId, receiverId].sort().join('_');
        const message = new Message({ chatId, senderId, receiverId, message: text, read: false });
        await message.save();

        // ✅ Send to receiver's room
        io.to(receiverId).emit("receiveMessage", message);

        // ✅ Confirm back only to the sender who sent it
        socket.emit("receiveMessage", message);

        // ✅ Send notification to receiver
        io.to(receiverId).emit("notification", {
            from: senderId,
            text,
            time: new Date().toISOString(),
        });

        //When user opens chat, mark messages as read
        socket.on('markAsRead', async ({ userId, withUserId }) => {
            await Message.updateMany(
                { senderId: withUserId, receiverId: userId, read: false },
                { $set: { read: true } }
            )
        })

        console.log(`📩 Message from ${senderId} → ${receiverId}: ${text}`);
    });

    socket.on('leave', (userId) => {
        if (socket.userId) {
            usersOnline.delete(socket.userId);
            lastSeen[socket.userId] = Date.now()
            io.emit('onlineUsers', {
                online: Array.from(usersOnline),
                lastSeen
            })
        }
        socket.leave(userId)
        console.log(`User ${userId} joined room.`)
    })

    socket.on("disconnect", () => {
        if (socket.userId) {
            usersOnline.delete(socket.userId);
            lastSeen[socket.userId] = Date.now()
            io.emit('onlineUsers', {
                online: Array.from(usersOnline),
                lastSeen
            })
        }
        console.log("User disconnected: ", socket.id, socket.userId || "");
    });
});


//Messages history
app.get('/messages/:userId/:receiverId', async (req, res) => {
    const { userId, receiverId } = req.params;
    try {

        //Ensure a consistent chatId (so order of sender/receiver doesn't matter)
        const chatId = [userId, receiverId].sort().join('_')
        const messages = await Message.find({ chatId }).sort({ createdAt: 1 }); //oldest -> newest
        res.json(messages)
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch messages' })
    }
})

// Upload route
app.post("/upload", upload.single("image"), async (req, res) => {
    try {
        const { userId } = req.body;
        const file = req.file;

        if (!file) return res.status(400).json({ error: "No file uploaded" })

        //Generate unique filename
        const fileExt = path.extname(file.originalname);
        const fileName = `${userId}-${Date.now()}${fileExt}`;

        //Find user profile
        let profile = await Profile.findOne({ userId })

        //Delete old Image from supabase if exists
        if (profile && profile.profileImage) {
            //Supabase public URL looks like
            const oldFileName = profile.profileImage.split("/").pop();
            const { error: deleteError } = await supabase.storage
                .from("uploads")
                .remove([oldFileName])

            if (deleteError) {
                console.warn(deleteError.message)
            } else {
                console.log(oldFileName)
            }
        }

        //Upload new image to supabase storage
        const { error: uploadError } = await supabase.storage
            .from('uploads')
            .upload(fileName, file.buffer, {
                cacheControl: '3600',
                upsert: true,
                contentType: file.mimetype,
            })
        if (uploadError) throw uploadError;

        //Get puplic url of uploaded file
        const { data: publicUrl } = supabase.storage
            .from('uploads')
            .getPublicUrl(fileName);

        //Save new image url in profile
        profile = await Profile.findOneAndUpdate(
            { userId },
            { profileImage: publicUrl.publicUrl },
            { upsert: true, new: true }
        )
        res.send(profile)

    } catch (error) {
        console.error("Upload failed", error)
    }
})

//Send connection request
app.post('/send-request', async (req, res) => {
    const notification = new Notification(req.body);
    await notification.save()
    res.send(notification)
})

//Check if request sent.
app.post('/check-request', async (req, res) => {
    const { senderId } = req.body;
    const notification = await Notification.find({ senderId: senderId })
    res.send(notification);
})

//check if received a request
app.post('/check-sent', async (req, res) => {
    const { receiverId } = req.body;
    const notification = await Notification.find({ receiverId: receiverId });
    res.send(notification)
})

// Fetch notifications
app.post('/fetch-notifications', async (req, res) => {
    const { userId } = req.body;
    const notifications = await Notification.find({ receiverId: userId })
    res.send(notifications)
})

//Fetch profile per user
app.get('/get-profile/:senderId', async (req, res) => {
    const { senderId } = req.params;
    const profile = await Profile.findOne({ userId: senderId })
    res.send(profile);
})

//Add connects
app.post('/add-connects', async (req, res) => {
    const connected = new Connected(req.body);
    await connected.save();
    res.send(connected);
})

//Check if connected
app.post('/check-connected', async (req, res) => {
    const { receiverId } = req.body;
    const connected1 = await Connected.find({ receiverId: receiverId })
    const connected2 = await Connected.find({ senderId: receiverId })
    if (connected1.length === 0) {
        res.send(connected2)
    } else {
        res.send(connected1)
    }
})

//Fetch all connected users
app.post('/connected-users', async (req, res) => {
    const { userId } = req.body;
    const connected = await Connected.find({
        $or: [
            { receiverId: userId },
            { senderId: userId }
        ]
    })
    res.send(connected)
})

//Email API
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
    },
})

//Send feedbacks
app.post('/send-email', async (req, res) => {
    const { from, message } = req.body;
    try {
        await transporter.sendMail({
            from: from,
            to: process.env.CO_EMAIL,
            subject: `SKILL.IN CUSTOMER: ${from}`,
            text: message
        }, (err, info) => {
            console.error(info)
        })
        res.json({ message: 'sent' })
    } catch (error) {
        console.error(error)
    }
})


server.listen(3000, () => console.log('Server running on http://localhost:3000'));
app.listen(3000, () => console.log('Node running on http://localhost:3000'));
