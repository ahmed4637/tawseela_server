const mongoose = require('mongoose');

const supportMessageSchema = new mongoose.Schema(
  {
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupportTicket',
      required: [true, 'رقم التذكرة مطلوب'],
    },

    senderAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'رقم المرسل مطلوب'],
    },

    senderType: {
      type: String,
      enum: ['user', 'admin', 'system'],
      required: true,
    },

    messageType: {
      type: String,
      enum: ['text', 'image', 'file', 'system'],
      default: 'text',
    },

    text: {
      type: String,
      trim: true,
      default: '',
      maxlength: [3000, 'الرسالة طويلة جدًا'],
    },

    attachments: {
      type: [
        {
          url: {
            type: String,
            trim: true,
            required: true,
          },
          type: {
            type: String,
            enum: ['image', 'file'],
            default: 'image',
          },
          name: {
            type: String,
            trim: true,
            default: '',
          },
        },
      ],
      default: [],
    },

    readByUserAt: {
      type: Date,
      default: null,
    },

    readByAdminAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

supportMessageSchema.index({ ticketId: 1, createdAt: -1 });
supportMessageSchema.index({ senderAccountId: 1, createdAt: -1 });

const SupportMessage = mongoose.model('SupportMessage', supportMessageSchema);

module.exports = SupportMessage;
