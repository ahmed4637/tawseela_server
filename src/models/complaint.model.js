const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema(
  {
    complaintCode: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },

    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: true,
    },

    fromAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },

    againstAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },

    fromRole: {
      type: String,
      enum: ['customer', 'driver'],
      required: true,
    },

    againstRole: {
      type: String,
      enum: ['customer', 'driver'],
      required: true,
    },

    category: {
      type: String,
      enum: [
        'late',
        'no_show',
        'bad_behavior',
        'price_issue',
        'safety',
        'payment',
        'route_issue',
        'vehicle_issue',
        'item_issue',
        'other',
      ],
      default: 'other',
    },

    title: {
      type: String,
      required: [true, 'عنوان الشكوى مطلوب'],
      trim: true,
      maxlength: [120, 'عنوان الشكوى طويل جدًا'],
    },

    description: {
      type: String,
      required: [true, 'وصف الشكوى مطلوب'],
      trim: true,
      maxlength: [1500, 'وصف الشكوى طويل جدًا'],
    },

    images: {
      type: [String],
      default: [],
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

    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },

    status: {
      type: String,
      enum: ['open', 'under_review', 'in_review', 'resolved', 'rejected', 'closed'],
      default: 'open',
    },

    assignedAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    linkedSupportTicketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupportTicket',
      default: null,
    },

    adminNote: {
      type: String,
      trim: true,
      default: '',
    },

    resolutionNote: {
      type: String,
      trim: true,
      default: '',
    },

    resolvedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

complaintSchema.index({ complaintCode: 1 }, { unique: true, sparse: true });
complaintSchema.index({ serviceRequestId: 1, createdAt: -1 });
complaintSchema.index({ status: 1, priority: 1, createdAt: -1 });
complaintSchema.index({ assignedAdminId: 1, status: 1, createdAt: -1 });
complaintSchema.index({ fromAccountId: 1, createdAt: -1 });
complaintSchema.index({ againstAccountId: 1, createdAt: -1 });

complaintSchema.pre('save', function generateComplaintCode(next) {
  if (!this.complaintCode) {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
    this.complaintCode = `CMP-${datePart}-${randomPart}`;
  }

  if (this.status === 'in_review') {
    this.status = 'under_review';
  }

  next();
});

const Complaint = mongoose.model('Complaint', complaintSchema);

module.exports = Complaint;
