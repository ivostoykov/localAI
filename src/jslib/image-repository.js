class ImageRepository {
    constructor() {
        this.sessionRepo = null;
    }

    setSessionRepository(sessionRepositoryInstance) {
        this.sessionRepo = sessionRepositoryInstance;
    }

    async storeImage(sessionId, file) {
        try {
            const base64 = await this.fileToBase64(file);
            const thumbnail = await this.generateThumbnail(base64);
            const imageId = crypto.randomUUID();

            const imageData = {
                id: imageId,
                base64: base64,
                thumbnail: thumbnail,
                filename: file.name,
                mimeType: file.type || 'image/jpeg',
                size: file.size,
                addedAt: Date.now()
            };

            if (!this.sessionRepo) {
                throw new Error('Session repository not initialised');
            }

            await this.sessionRepo.storeImage(sessionId, imageData);

            return imageId;
        } catch (error) {
            console.error(`>>> ${manifest?.name ?? ''} - imageRepository.storeImage:`, error);
            throw error;
        }
    }

    async getImage(sessionId, imageId) {
        if (!this.sessionRepo) {
            throw new Error('Session repository not initialised');
        }

        try {
            return await this.sessionRepo.getImage(sessionId, imageId);
        } catch (error) {
            console.error(`>>> ${manifest?.name ?? ''} - imageRepository.getImage:`, error);
            return null;
        }
    }

    async getThumbnail(sessionId, imageId) {
        const img = await this.getImage(sessionId, imageId);
        return img?.thumbnail || null;
    }

    async resolveImageRefs(sessionId, imageRefs) {
        if (!this.sessionRepo) {
            throw new Error('Session repository not initialised');
        }

        try {
            return await this.sessionRepo.resolveImageRefs(sessionId, imageRefs);
        } catch (error) {
            console.error(`>>> ${manifest?.name ?? ''} - imageRepository.resolveImageRefs:`, error);
            return [];
        }
    }

    async fileToBase64(file) {
        // Check if file type is supported (PNG or JPEG only)
        const supportedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
        if (!supportedTypes.includes(file.type.toLowerCase())) {
            throw new Error(`Image format not supported. Please use PNG or JPEG format. (Received: ${file.type})`);
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => {
                const base64 = reader.result.split(',').pop();
                resolve(base64);
            };

            reader.onerror = () => {
                reject(new Error(`Failed to read file: ${file.name}`));
            };

            reader.readAsDataURL(file);
        });
    }

    async generateThumbnail(base64, maxSize = 100) {
        return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > maxSize) {
                            height = Math.round((height * maxSize) / width);
                            width = maxSize;
                        }
                    } else {
                        if (height > maxSize) {
                            width = Math.round((width * maxSize) / height);
                            height = maxSize;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;

                    ctx.drawImage(img, 0, 0, width, height);

                    const thumbnailBase64 = canvas.toDataURL('image/jpeg', 0.7).split(',').pop();
                    resolve(thumbnailBase64);

                } catch (error) {
                    console.error(`>>> ${manifest?.name ?? ''} - imageRepository.generateThumbnail:`, error);
                    resolve(base64);
                }
            };

            img.onerror = () => {
                console.error(`>>> ${manifest?.name ?? ''} - imageRepository: Failed to load image for thumbnail`);
                resolve(base64);
            };

            img.src = `data:image/jpeg;base64,${base64}`;
        });
    }

    async deleteImage(sessionId, imageId) {
        if (!this.sessionRepo) {
            throw new Error('Session repository not initialised');
        }

        try {
            const context = await this.sessionRepo.db.getContext(sessionId);
            if (!context || !context.images) {
                return;
            }

            context.images = context.images.filter(img => img.id !== imageId);
            await this.sessionRepo.db.put('context', context);
        } catch (error) {
            console.error(`>>> ${manifest?.name ?? ''} - imageRepository.deleteImage:`, error);
            throw error;
        }
    }

    async getSessionImages(sessionId) {
        if (!this.sessionRepo) {
            throw new Error('Session repository not initialised');
        }

        try {
            const context = await this.sessionRepo.db.getContext(sessionId);
            return context?.images || [];
        } catch (error) {
            console.error(`>>> ${manifest?.name ?? ''} - imageRepository.getSessionImages:`, error);
            return [];
        }
    }

    isValidImageFile(file) {
        const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
        const maxSize = 10 * 1024 * 1024; // 10MB

        if (!validTypes.includes(file.type)) {
            console.warn(`>>> ${manifest?.name ?? ''} - imageRepository: Invalid image type: ${file.type}`);
            return false;
        }

        if (file.size > maxSize) {
            console.warn(`>>> ${manifest?.name ?? ''} - imageRepository: Image too large: ${file.size} bytes`);
            return false;
        }

        return true;
    }
}

const imageRepository = new ImageRepository();
