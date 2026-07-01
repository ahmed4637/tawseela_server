const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatRoom',
      required: [true, 'رقم غرفة الشات مطلوب'],
    },

    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: [true, 'رقم الطلب مطلوب'],
    },

    senderAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'رقم حساب المرسل مطلوب'],
    },

    receiverAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'رقم حساب المستقبل مطلوب'],
    },

    messageType: {
      type: String,
      enum: ['text', 'image', 'location', 'system'],
      default: 'text',
    },

    text: {
      type: String,
      trim: true,
      default: '',
      maxlength: [2000, 'نص الرسالة طويل جدًا'],
    },

    mediaUrl: {
      type: String,
      trim: true,
      default: '',
    },

    location: {
      lat: {
        type: Number,
        default: null,
      },
      lng: {
        type: Number,
        default: null,
      },
      address: {
        type: String,
        trim: true,
        default: '',
      },
    },

    isRead: {
      type: Boolean,
      default: false,
    },

    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

chatMessageSchema.index({ roomId: 1, createdAt: -1 });
chatMessageSchema.index({ serviceRequestId: 1, createdAt: -1 });
chatMessageSchema.index({ senderAccountId: 1, createdAt: -1 });
chatMessageSchema.index({ receiverAccountId: 1, isRead: 1 });

chatMessageSchema.methods.toSafeObject = function () {
  const message = this.toObject();
  delete message.__v;
  return message;
};

const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);

module.exports = ChatMessage;
