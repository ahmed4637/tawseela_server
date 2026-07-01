const mongoose = require('mongoose');

const chatRoomSchema = new mongoose.Schema(
  {
    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: [true, 'رقم الطلب مطلوب'],
      unique: true,
    },

    acceptedOfferId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceOffer',
      required: [true, 'رقم العرض المقبول مطلوب'],
    },

    customerAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'رقم حساب العميل مطلوب'],
    },

    driverAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'رقم حساب السائق مطلوب'],
    },

    status: {
      type: String,
      enum: ['active', 'closed'],
      default: 'active',
    },

    lastMessageText: {
      type: String,
      trim: true,
      default: '',
    },

    lastMessageAt: {
      type: Date,
      default: null,
    },

    closedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

chatRoomSchema.index({ customerAccountId: 1, updatedAt: -1 });
chatRoomSchema.index({ driverAccountId: 1, updatedAt: -1 });
chatRoomSchema.index({ status: 1, updatedAt: -1 });

chatRoomSchema.methods.toSafeObject = function () {
  const room = this.toObject();
  delete room.__v;
  return room;
};

const ChatRoom = mongoose.model('ChatRoom', chatRoomSchema);

module.exports = ChatRoom;
