// backend/src/utils/cloudinary.js
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "",
  api_key: process.env.CLOUDINARY_API_KEY || "",
  api_secret: process.env.CLOUDINARY_API_SECRET || "",
});

// buffer -> cloudinary
export async function uploadBufferToCloudinary(buffer, options = {}) {
  const folder = process.env.CLOUDINARY_FOLDER || "freshbuy/products";

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        ...options,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );

    stream.end(buffer);
  });
}

export async function deleteFromCloudinary(publicId) {
  if (!publicId) return null;
  return cloudinary.uploader.destroy(publicId);
}
