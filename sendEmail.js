const sgMail = require('@sendgrid/mail')
require('dotenv').config()

sgMail.setApiKey(process.env.SENDGRID_API_KEY)

const sendEmail = async ({ to, subject, text, html }) => {
    const msg = {
        to,
        from: process.env.EMAIL_USER,
        subject,
        text,
        html
    }

    try {
        const response = await sgMail.send(msg)
        console.log("Email sent: ", response[0].statusCode)
        return response
    } catch (error) {
        console.error("Error sending email: ", error.response?.body || error.message)
    }
}

module.exports = { sendEmail }