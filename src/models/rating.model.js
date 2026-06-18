const mongoose = require('mongoose');

const ratingSchema = new mongoose.Schema(
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

    toAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },

    fromRole: {
      type: String,
      enum: ['customer', 'driver'],
      required: true,
    },

    toRole: {
      type: String,
      enum: ['customer', 'driver'],
      required: true,
    },

    stars: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },

    comment: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'التعليق طويل جدًا'],
    },
  },
  {
    timestamps: true,
  }
);

ratingSchema.index(
  { serviceRequestId: 1, fromAccountId: 1, toAccountId: 1 },
  { unique: true }
);

ratingSchema.index({ toAccountId: 1, createdAt: -1 });

const Rating = mongoose.model('Rating', ratingSchema);

module.exports = Rating;