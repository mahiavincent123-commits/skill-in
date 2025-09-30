const mongoose = require('mongoose')
require('dotenv').config()

const uri = process.env.MONGO_URI;
mongoose.connect(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log("Connected to MongoDB"))
    .catch(err => console.error("MongoDB connection error: ", err))


//users collection
const UserSchema = new mongoose.Schema({
    userId: {
        type: String,
        require: true,
        unique: true,
    }
}, { timestamps: { createdAt: "created_at", updatedAt: false } });
const Users = mongoose.model('users', UserSchema)

// Profile collection
const ProfileSchema = new mongoose.Schema({
    userId: String,
    name: String,
    email: String,
    description: String,
    profileImage: String,
    skillHave: [String],
    skillWant: [String],
    social: {
        twitter: String,
        linkedIn: String,
        instagram: String,
        facebook: String,
        youtube: String,
        telegram: String
    }
})
const Profile = mongoose.model('profiles', ProfileSchema)

//Messages collection
const MessagesSchema = new mongoose.Schema({
    chatId: {
        type: String,
        required: true
    },
    senderId: {
        type: String,
        ref: "User",
        required: true,
    },
    receiverId: {
        type: String,
        ref: "User",
        required: true,
    },
    message: {
        type: String,
        trim: true,
        required: true,
    },
    read: {
        type: Boolean,
        default: false,
    },
    delivered: {
        type: Boolean,
        default: false,
    },
    type: {
        type: String,
        enum: ['text', "image", 'file'],
        default: 'text',
    },
}, { timestamps: true })

const Message = mongoose.model("messages", MessagesSchema)

//Notification collection
const NotificationSchema = new mongoose.Schema({
    senderId: String,
    receiverId: String,
    message: String,
    profileImage: String,
    created_at: { type: Date, default: Date.now() }
})

const Notification = mongoose.model("notifications", NotificationSchema)

// Connected collection
const ConnectedSchema = new mongoose.Schema({
    senderId: String,
    receiverId: String,
    created_at: { type: Date, default: Date.now() }
})
const Connected = mongoose.model('connects', ConnectedSchema)
module.exports = { Users, Profile, Message, Notification, Connected }