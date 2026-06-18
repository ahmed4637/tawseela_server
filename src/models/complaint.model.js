const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema(
  {
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

    category: {
      type: String,
      enum: [
        'late',
        'no_show',
        'bad_behavior',
        'price_issue',
        'safety',
        'payment',
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
      maxlength: [1000, 'وصف الشكوى طويل جدًا'],
    },

    images: {
      type: [String],
      default: [],
    },

    status: {
      type: String,
      enum: ['open', 'under_review', 'resolved', 'rejected'],
      default: 'open',
    },

    adminNote: {
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
  }
);

complaintSchema.index({ serviceRequestId: 1, createdAt: -1 });
complaintSchema.index({ status: 1, createdAt: -1 });
complaintSchema.index({ fromAccountId: 1, createdAt: -1 });
complaintSchema.index({ againstAccountId: 1, createdAt: -1 });

const Complaint = mongoose.model('Complaint', complaintSchema);

module.exports = Complaint;