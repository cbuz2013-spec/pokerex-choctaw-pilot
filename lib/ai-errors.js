// Never echo provider responses, credentials, or account URLs into the UI.
export function photoServiceError(status, data = {}) {
  const code = String(data?.error?.code || data?.error?.type || '');
  const detail = String(data?.error?.message || '');
  let message = 'Photo reading is temporarily unavailable. Keep the image and try again; manual entry is still available.';
  if (/quota|credit|billing/i.test(code + ' ' + detail)) message = 'Photo reading is unavailable because the AI account has no available credits. Ask the owner to restore billing, then retry this image. Manual entry is still available.';
  else if ([401, 403, 404].includes(status)) message = 'Photo reading needs the owner to check the AI key and model configuration. Keep the image for retry; manual entry is still available.';
  else if (status === 429) message = 'Photo reading is busy. Wait a moment and retry this image.';
  return Object.assign(new Error(message), {status: 503});
}
