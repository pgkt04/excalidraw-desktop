(function () {
  const workspaceNameEl = document.getElementById('workspace-name');
  const changeFolderBtn = document.getElementById('change-folder-btn');
  const chooseFolderBtn = document.getElementById('choose-folder-btn');
  const newFileBtn = document.getElementById('new-file-btn');
  const emptyStateEl = document.getElementById('empty-state');
  const fileListEl = document.getElementById('file-list');
  const collapseBtn = document.getElementById('collapse-btn');
  const expandBtn = document.getElementById('expand-btn');

  let currentFiles = [];
  let currentFilePath = null;
  let editingPath = null;

  function basename(filePath) {
    if (!filePath) return '';
    return filePath.replace(/\\/g, '/').split('/').pop();
  }

  function renderWorkspaceHeader(workspaceDir) {
    const hasWorkspace = Boolean(workspaceDir);
    workspaceNameEl.textContent = hasWorkspace ? basename(workspaceDir) : 'No folder selected';
    workspaceNameEl.title = hasWorkspace ? workspaceDir : '';
    newFileBtn.disabled = !hasWorkspace;
    emptyStateEl.style.display = hasWorkspace ? 'none' : 'block';
    fileListEl.style.display = hasWorkspace ? 'block' : 'none';
  }

  function makeFileRow(file) {
    const li = document.createElement('li');
    li.className = 'file-row' + (file.path === currentFilePath ? ' active' : '');
    li.dataset.path = file.path;

    if (editingPath === file.path) {
      const input = document.createElement('input');
      input.className = 'rename-input';
      input.value = basename(file.path);
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          commitRename(file.path, input.value);
        } else if (e.key === 'Escape') {
          editingPath = null;
          renderFileList(currentFiles);
        }
      });
      input.addEventListener('blur', () => {
        if (editingPath === file.path) {
          commitRename(file.path, input.value);
        }
      });
      li.appendChild(input);
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
      return li;
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = basename(file.path);
    nameSpan.title = basename(file.path);
    li.appendChild(nameSpan);

    const actions = document.createElement('span');
    actions.className = 'file-actions';

    const renameBtn = document.createElement('button');
    renameBtn.textContent = '✏️';
    renameBtn.title = 'Rename';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      editingPath = file.path;
      renderFileList(currentFiles);
    });
    actions.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '🗑';
    deleteBtn.title = 'Delete';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.workspaceAPI.deleteFile(file.path);
    });
    actions.appendChild(deleteBtn);

    li.appendChild(actions);

    li.addEventListener('click', () => {
      window.workspaceAPI.openFile(file.path);
    });

    return li;
  }

  function commitRename(oldPath, rawName) {
    editingPath = null;
    const trimmed = rawName.trim();
    if (trimmed && trimmed !== basename(oldPath)) {
      // Re-render regardless of outcome: on success the filesChanged event
      // refreshes the list anyway, but on failure nothing else would remove
      // the stale rename input.
      window.workspaceAPI.renameFile(oldPath, trimmed).finally(() => renderFileList(currentFiles));
    } else {
      renderFileList(currentFiles);
    }
  }

  function renderFileList(files) {
    currentFiles = files || [];
    fileListEl.innerHTML = '';

    if (currentFiles.length === 0) {
      const li = document.createElement('li');
      li.className = 'no-files';
      li.textContent = 'No .excalidraw files in this folder.';
      fileListEl.appendChild(li);
      return;
    }

    for (const file of currentFiles) {
      fileListEl.appendChild(makeFileRow(file));
    }
  }

  function highlightActiveFile(filePath) {
    currentFilePath = filePath;
    renderFileList(currentFiles);
  }

  function setCollapsed(collapsed) {
    document.body.classList.toggle('collapsed', Boolean(collapsed));
  }

  changeFolderBtn.addEventListener('click', () => window.workspaceAPI.selectFolder());
  chooseFolderBtn.addEventListener('click', () => window.workspaceAPI.selectFolder());
  newFileBtn.addEventListener('click', () => window.workspaceAPI.newFile());
  collapseBtn.addEventListener('click', () => window.workspaceAPI.toggleSidebar());
  expandBtn.addEventListener('click', () => window.workspaceAPI.toggleSidebar());

  window.workspaceAPI.onCollapsedChanged(setCollapsed);

  window.workspaceAPI.onWorkspaceChanged((workspaceDir) => {
    renderWorkspaceHeader(workspaceDir);
    if (!workspaceDir) {
      renderFileList([]);
    }
  });
  window.workspaceAPI.onFilesChanged((files) => renderFileList(files));
  window.workspaceAPI.onCurrentFileChanged((filePath) => highlightActiveFile(filePath));

  window.workspaceAPI.getInitialState().then((state) => {
    if (!state) return;
    currentFilePath = state.currentFilePath || null;
    setCollapsed(state.collapsed);
    renderWorkspaceHeader(state.workspaceDir);
    renderFileList(state.files);
  });
})();
