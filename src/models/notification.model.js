const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true,
    },

    templateKey: {
      type: String,
      trim: true,
      default: '',
      lowercase: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    body: {
      type: String,
      required: true,
      trim: true,
    },

    type: {
      type: String,
      enum: [
        'general',
        'request',
        'offer',
        'negotiation',
        'trip',
        'chat',
        'payment',
        'promo',
        'loyalty',
        'penalty',
        'complaint',
        'review',
        'scheduled_reminder',
        'admin',
      ],
      default: 'general',
    },

    data: {
      type: Object,
      default: {},
    },

    isRead: {
      type: Boolean,
      default: false,
    },

    readAt: {
      type: Date,
      default: null,
    },

    pushStatus: {
      type: String,
      enum: ['not_requested', 'pending', 'sent', 'partial', 'failed', 'skipped'],
      default: 'not_requested',
      index: true,
    },

    pushSentAt: {
      type: Date,
      default: null,
    },

    pushResult: {
      successCount: {
        type: Number,
        default: 0,
      },
      failureCount: {
        type: Number,
        default: 0,
      },
      failedTokens: {
        type: [String],
        default: [],
      },
      errorMessage: {
        type: String,
        trim: true,
        default: '',
      },
    },
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({ accountId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ templateKey: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
