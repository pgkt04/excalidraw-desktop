(function () {
  const params = new URLSearchParams(location.search);
  const defaultName = params.get('default') || 'Untitled';

  const form = document.getElementById('new-file-form');
  const input = document.getElementById('name-input');
  const feedback = document.getElementById('feedback');
  const cancelBtn = document.getElementById('cancel-btn');

  input.placeholder = defaultName;

  // Mirrors index.js's sanitizeBaseName() so the live preview matches what
  // the main process will actually do with the name.
  const ILLEGAL_FILENAME_CHARS_REGEX = /[\\/:*?"<>|\x00-\x1F]/g;
  const WINDOWS_RESERVED_NAMES = new Set([
    'CON',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'COM2',
    'COM3',
    'COM4',
    'COM5',
    'COM6',
    'COM7',
    'COM8',
    'COM9',
    'LPT1',
    'LPT2',
    'LPT3',
    'LPT4',
    'LPT5',
    'LPT6',
    'LPT7',
    'LPT8',
    'LPT9',
  ]);
  const MAX_BASENAME_LENGTH = 150;

  function sanitizeBaseName(name) {
    let result = String(name || '').replace(ILLEGAL_FILENAME_CHARS_REGEX, '');
    result = result.replace(/\.excalidraw$/i, '');
    result = result.trim().replace(/[. ]+$/, '');
    if (!result) return '';
    if (WINDOWS_RESERVED_NAMES.has(result.toUpperCase())) return '';
    return result.slice(0, MAX_BASENAME_LENGTH);
  }

  let existingNames = [];

  function updateFeedback() {
    const sanitized = sanitizeBaseName(input.value);

    if (!sanitized) {
      feedback.textContent = `Will use default name: ${defaultName}.excalidraw`;
      feedback.classList.remove('danger');
      return;
    }

    if (existingNames.includes(sanitized.toLowerCase())) {
      feedback.textContent = `Will be saved as: ${sanitized}.excalidraw — a file with this name exists, will be saved as "${sanitized} (2).excalidraw"`;
      feedback.classList.add('danger');
    } else {
      feedback.textContent = `Will be saved as: ${sanitized}.excalidraw`;
      feedback.classList.remove('danger');
    }
  }

  input.addEventListener('input', updateFeedback);
  updateFeedback();
  input.focus();

  window.newFileDialogAPI.getExistingNames().then((names) => {
    existingNames = names || [];
    updateFeedback();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    window.newFileDialogAPI.submit(input.value);
  });

  cancelBtn.addEventListener('click', () => {
    window.newFileDialogAPI.cancel();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      window.newFileDialogAPI.cancel();
    }
  });
})();
