import { getApiUrl } from '../config/api.js';

/**
 * Uploads a document with live percentage tracking using XMLHttpRequest.
 * 
 * Progress stages:
 * - 0% - 70%: Uploading raw bytes to backend server
 * - 70% - 98%: Processing document, extracting text, computing 384-d MiniLM vector embeddings
 * - 100%: Completed & indexed in vector vault
 *
 * @param {File} file - Document file to upload (.pdf or .txt)
 * @param {Function} onProgress - Callback receiving { percent, stage, statusText }
 * @returns {Promise<Object>} Backend response JSON
 */
export function uploadDocumentWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const targetUrl = getApiUrl('/api/documents/upload');

    xhr.open('POST', targetUrl, true);
    xhr.withCredentials = true;

    // Attach Bearer token from localStorage for CORS authenticated requests
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    // Set 180-second timeout to safely accommodate cold starts and multi-page PDFs
    xhr.timeout = 180000;

    let processingInterval = null;

    // Byte upload progress: 0% to 90%
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        const rawPercent = Math.round((event.loaded / event.total) * 90);
        onProgress({
          percent: Math.min(rawPercent, 90),
          stage: 'uploading',
          statusText: `Uploading: ${Math.min(rawPercent, 90)}%`,
        });
      }
    };

    // When all bytes are uploaded, advance into server processing stage (90% - 99%)
    xhr.upload.onload = () => {
      let currentProgress = 92;
      onProgress({
        percent: currentProgress,
        stage: 'processing',
        statusText: 'Uploaded! Initializing document processing...',
      });

      processingInterval = setInterval(() => {
        if (currentProgress < 98) {
          currentProgress += 1;
          onProgress({
            percent: currentProgress,
            stage: 'processing',
            statusText: `Finalizing upload (${currentProgress}%)...`,
          });
        }
      }, 500);
    };

    xhr.onload = () => {
      if (processingInterval) clearInterval(processingInterval);

      let responseData = null;
      try {
        responseData = JSON.parse(xhr.responseText);
      } catch {
        responseData = null;
      }

      if (xhr.status >= 200 && xhr.status < 300 && responseData?.success) {
        onProgress({
          percent: 100,
          stage: 'complete',
          statusText: 'Uploaded! Vectorizing in background...',
        });
        resolve(responseData);
      } else {
        const errorMessage =
          responseData?.message ||
          (xhr.status === 401
            ? 'Session expired. Please log in again.'
            : xhr.status === 413
            ? 'File size exceeds maximum allowed upload limit (15MB).'
            : xhr.status === 429
            ? 'Upload rate limit reached. Please wait a few minutes before trying again.'
            : `Upload failed (Server returned status ${xhr.status}).`);
        
        onProgress({
          percent: 100,
          stage: 'error',
          statusText: errorMessage,
        });
        reject(new Error(errorMessage));
      }
    };

    xhr.onerror = () => {
      if (processingInterval) clearInterval(processingInterval);
      const networkError = 'Network connection interrupted or server waking up. Please verify your connection and try again.';
      onProgress({
        percent: 100,
        stage: 'error',
        statusText: networkError,
      });
      reject(new Error(networkError));
    };

    xhr.ontimeout = () => {
      if (processingInterval) clearInterval(processingInterval);
      const timeoutError = 'Upload timed out after 180s. Processing took too long on the cloud server. Please retry or try with a smaller file.';
      onProgress({
        percent: 100,
        stage: 'error',
        statusText: timeoutError,
      });
      reject(new Error(timeoutError));
    };

    const formData = new FormData();
    formData.append('file', file);
    xhr.send(formData);
  });
}
