const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema(
  {
    ticketCode: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },

    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'رقم الحساب مطلوب'],
    },

    accountRole: {
      type: String,
      enum: ['customer', 'driver', 'admin', 'unknown'],
      default: 'unknown',
    },

    relatedServiceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      default: null,
    },

    relatedComplaintId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Complaint',
      default: null,
    },

    subject: {
      type: String,
      required: [true, 'موضوع التذكرة مطلوب'],
      trim: true,
      maxlength: [160, 'موضوع التذكرة طويل جدًا'],
    },

    category: {
      type: String,
      enum: [
        'account',
        'request',
        'trip',
        'payment',
        'promo',
        'loyalty',
        'driver_review',
        'technical',
        'complaint_followup',
        'other',
      ],
      default: 'other',
    },

    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },

    status: {
      type: String,
      enum: ['open', 'pending_user', 'pending_admin', 'resolved', 'closed'],
      default: 'open',
    },

    assignedAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    lastMessage: {
      text: {
        type: String,
        trim: true,
        default: '',
      },
      senderAccountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
        default: null,
      },
      senderType: {
        type: String,
        enum: ['user', 'admin', 'system', null],
        default: null,
      },
      createdAt: {
        type: Date,
        default: null,
      },
    },

    closedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    closedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

supportTicketSchema.index({ accountId: 1, createdAt: -1 });
supportTicketSchema.index({ relatedServiceRequestId: 1, createdAt: -1 });
supportTicketSchema.index({ relatedComplaintId: 1, createdAt: -1 });
supportTicketSchema.index({ status: 1, priority: 1, createdAt: -1 });
supportTicketSchema.index({ assignedAdminId: 1, status: 1, createdAt: -1 });

supportTicketSchema.pre('save', function generateTicketCode(next) {
  if (!this.ticketCode) {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
    this.ticketCode = `SUP-${datePart}-${randomPart}`;
  }

  next();
});

const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);

module.exports = SupportTicket;
