import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
  } from '@whiskeysockets/baileys'
  import qrcode from 'qrcode-terminal'
  import axios from 'axios'
  import fs from 'fs'
  
  // 🔗 Replace with your actual Pabbly webhook URL
  const PABBLY_WEBHOOK_URL =
    'https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjYwNTY1MDYzMTA0MzM1MjZjNTUzNjUxM2Ii_pc'
  
  // ✅ Function to send data to Pabbly
  async function sendToPabbly(data) {
    try {
      await axios.post(PABBLY_WEBHOOK_URL, data)
      console.log('✅ Data sent to Pabbly successfully!')
    } catch (error) {
      console.error('❌ Error sending data to Pabbly:', error.message)
    }
  }
  
  // 🧠 Track user state with session management
  const userProgress = {}
  const SESSION_TIMEOUT = 30 * 60 * 1000 // 30 minutes timeout

  // Clear inactive sessions
  setInterval(() => {
    const now = Date.now()
    Object.keys(userProgress).forEach(userId => {
      if (now - userProgress[userId].lastActivity > SESSION_TIMEOUT) {
        console.log(`⏰ Session timeout for ${userId}`)
        delete userProgress[userId]
      }
    })
  }, 5 * 60 * 1000) // Check every 5 minutes

  const questions = [
    '✅ Great! First, may I know your Full Name?',
    "What's your Phone Number?",
    "What's your Email?",
    "What's your Street Address?",
    "What's your Postal Code?",
  ]
  
  async function startBot() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState('./auth')
      const sock = makeWASocket({
        auth: state,
        browser: ['NodeBot', 'Chrome', '1.0.0'],
        printQRInTerminal: false,
      })
  
      sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update
  
        if (qr) {
          console.log('\n📱 Scan this QR code with WhatsApp:\n')
          qrcode.generate(qr, { small: true })
        }
  
        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode
          const reason = statusCode || lastDisconnect?.error?.message || 'unknown'
          
          console.log('❌ Connection closed. Status:', reason)
          
          const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401
          
          if (isLoggedOut) {
            console.log('🚪 Device logged out. Cleaning auth folder...')
            try {
              if (fs.existsSync('./auth')) {
                fs.rmSync('./auth', { recursive: true, force: true })
                console.log('✅ Auth folder deleted.')
              }
            } catch (err) {
              console.error('❌ Error deleting auth folder:', err.message)
            }
            console.log('🔄 Restarting for fresh login in 2 seconds...')
            setTimeout(() => {
              startBot()
            }, 2000)
          } else {
            console.log('🔄 Reconnecting...')
            setTimeout(() => {
              startBot()
            }, 1000)
          }
        } else if (connection === 'open') {
          console.log('✅ Connected to WhatsApp!')
        }
      })
  
      sock.ev.on('creds.update', saveCreds)
  
      process.on('uncaughtException', (err) => {
        console.error('💥 Uncaught Exception:', err)
        startBot()
      })
      process.on('unhandledRejection', (err) => {
        console.error('💥 Unhandled Rejection:', err)
        startBot()
      })
  
      // 📨 Handle incoming messages
      sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
          const msg = messages[0]
          
          // Ignore if no message content
          if (!msg.message) return
          
          const from = msg.key.remoteJid
          
          // 🚫 Ignore group messages (groups end with @g.us)
          if (from.endsWith('@g.us')) {
            console.log('⏭️  Ignoring group message')
            return
          }
          
          // 🚫 Ignore messages from broadcast/status
          if (from === 'status@broadcast') return
          
          // 🚫 Ignore our own messages
          if (msg.key.fromMe) return
          
          // Extract text from message
          const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            ''
          const message = text.trim()
          
          // Ignore empty messages
          if (!message) return
          
          console.log(`💬 [${from.split('@')[0]}] ${message}`)

          // 🟢 Start the question flow
          if (message.toLowerCase() === 'get start') {
            userProgress[from] = { 
              step: 0, 
              answers: {},
              lastActivity: Date.now()
            }
            await sock.sendMessage(from, { text: questions[0] })
            console.log(`🆕 Started new session for ${from.split('@')[0]}`)
            return
          }

          // Handle "reset" command
          if (message.toLowerCase() === 'reset' || message.toLowerCase() === 'restart') {
            if (userProgress[from]) {
              delete userProgress[from]
              await sock.sendMessage(from, { text: '🔄 Session reset. Type "learn more" to start again.' })
              console.log(`🔄 Reset session for ${from.split('@')[0]}`)
            } else {
              await sock.sendMessage(from, { text: 'No active session. Type "learn more" to start.' })
            }
            return
          }
  
          // 🧩 Continue the flow if user is in progress
          if (userProgress[from]) {
            // Update last activity
            userProgress[from].lastActivity = Date.now()
            
            const step = userProgress[from].step
            console.log(`📍 [${from.split('@')[0]}] at step ${step}`)

            // Handle basic questions
            if (step >= 0 && step <= 4) {
              const keys = [
                'fullName',
                'phone',
                'email',
                'streetAddress',
                'postalCode',
              ]
              userProgress[from].answers[keys[step]] = message
              userProgress[from].step++
  
              if (userProgress[from].step <= 4) {
                await sock.sendMessage(from, {
                  text: questions[userProgress[from].step],
                })
                return
              }
  
              await sock.sendMessage(from, {
                text: 'Which type of property do you own?\n1) 2BHK\n2) 3BHK\n3) 4BHK/Duplex\n4) Villa',
              })
              return
            }
  
            // Property type
            if (step === 5) {
              const propertyMap = {
                1: '2BHK',
                2: '3BHK',
                3: '4BHK/Duplex',
                4: 'Villa',
              }
              if (!propertyMap[message]) {
                await sock.sendMessage(from, {
                  text: '❌ Please reply with 1, 2, 3, or 4.',
                })
                return
              }
              userProgress[from].answers.propertyType = propertyMap[message]
              userProgress[from].step++
              await sock.sendMessage(from, {
                text: 'What is your budget?\n1) Less than 10 lakhs\n2) 10 - 20 lakhs\n3) 20 - 30 lakhs\n4) 35+ lakhs',
              })
              return
            }
  
            // Budget
            if (step === 6) {
              const budgetMap = {
                1: 'Less than 10 lakhs',
                2: '10 - 20 lakhs',
                3: '20 - 30 lakhs',
                4: '35+ lakhs',
              }
              if (!budgetMap[message]) {
                await sock.sendMessage(from, {
                  text: '❌ Please reply with 1, 2, 3, or 4.',
                })
                return
              }
              userProgress[from].answers.budget = budgetMap[message]
              userProgress[from].step++
              await sock.sendMessage(from, {
                text: 'When can we call you?\n1) 10AM - 12PM\n2) 1PM - 3PM\n3) 4PM - 7PM',
              })
              return
            }
  
            // Call time
            if (step === 7) {
              const callMap = {
                1: '10AM - 12PM',
                2: '1PM - 3PM',
                3: '4PM - 7PM',
              }
              if (!callMap[message]) {
                await sock.sendMessage(from, {
                  text: '❌ Please reply with 1, 2, or 3.',
                })
                return
              }
              userProgress[from].answers.callTime = callMap[message]
              await sock.sendMessage(from, {
                text: '✅ Thanks! We`ll get back to you soon.',
              })
  
              // 🔥 Send data to Pabbly
              console.log(`📦 Sending collected info for ${from.split('@')[0]}:`, userProgress[from].answers)
              await sendToPabbly(userProgress[from].answers)
  
              delete userProgress[from]
              console.log(`✅ Session completed and closed for ${from.split('@')[0]}`)
              return
            }
          } 
        } catch (error) {
          console.error('❌ Error processing message:', error.message)
        }
      })
    } catch (err) {
      console.error('💥 Fatal error in startBot:', err)
      console.log('Restarting in 5s...')
      setTimeout(startBot, 5000)
    }
  }
  
  startBot()
