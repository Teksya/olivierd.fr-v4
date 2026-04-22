(function () {
  var orderList = document.getElementById('project-order-list');
  var orderInput = document.getElementById('project-order-input');
  var statusText = document.getElementById('project-order-status');

  if (!orderList || !orderInput) return;

  var draggedItem = null;
  var dragSourceHandle = null;
  var originalOrder = currentOrder().join(',');

  function listItems() {
    return Array.prototype.slice.call(orderList.querySelectorAll('.admin-reorder-item[data-id]'));
  }

  function currentOrder() {
    return listItems().map(function (item) {
      return item.dataset.id;
    });
  }

  function updateIndexes() {
    listItems().forEach(function (item, index) {
      var indexEl = item.querySelector('.admin-reorder-index');
      if (indexEl) indexEl.textContent = String(index + 1);
    });
  }

  function refreshOrderState() {
    var ids = currentOrder();
    var serialized = ids.join(',');

    orderInput.value = serialized;
    updateIndexes();

    if (!statusText) return;
    statusText.textContent = serialized === originalOrder
      ? 'Ordre inchangé.'
      : 'Ordre modifié. Cliquez sur enregistrer.';
  }

  function moveItemWithKeyboard(item, direction) {
    var sibling = direction < 0 ? item.previousElementSibling : item.nextElementSibling;
    if (!sibling) return;

    if (direction < 0) {
      orderList.insertBefore(item, sibling);
    } else {
      orderList.insertBefore(sibling, item);
    }

    refreshOrderState();

    var handle = item.querySelector('.admin-drag-handle');
    if (handle) handle.focus();
  }

  function placeItemAroundTarget(target, pointerY) {
    if (!draggedItem || !target || target === draggedItem) return;

    var rect = target.getBoundingClientRect();
    var insertBefore = pointerY < rect.top + rect.height / 2;

    if (insertBefore) {
      orderList.insertBefore(draggedItem, target);
    } else {
      orderList.insertBefore(draggedItem, target.nextSibling);
    }
  }

  listItems().forEach(function (item) {
    var handle = item.querySelector('.admin-drag-handle');

    if (handle) {
      handle.addEventListener('mousedown', function (event) {
        event.stopPropagation();
        dragSourceHandle = handle;
      });

      handle.addEventListener('touchstart', function () {
        dragSourceHandle = handle;
      }, { passive: true });

      handle.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
      });
    }

    item.addEventListener('dragstart', function (event) {
      if (handle && dragSourceHandle !== handle) {
        event.preventDefault();
        return;
      }

      draggedItem = item;
      item.classList.add('is-dragging');

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.dataset.id || '');
      }
    });

    item.addEventListener('dragover', function (event) {
      event.preventDefault();
      placeItemAroundTarget(item, event.clientY);
    });

    item.addEventListener('drop', function (event) {
      event.preventDefault();
      placeItemAroundTarget(item, event.clientY);
      refreshOrderState();
    });

    item.addEventListener('dragend', function () {
      item.classList.remove('is-dragging');
      draggedItem = null;
      dragSourceHandle = null;
      refreshOrderState();
    });

    if (!handle) return;

    handle.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveItemWithKeyboard(item, -1);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveItemWithKeyboard(item, 1);
      }
    });
  });

  document.addEventListener('mouseup', function () {
    dragSourceHandle = null;
  });

  document.addEventListener('touchend', function () {
    dragSourceHandle = null;
  });

  orderList.addEventListener('dragover', function (event) {
    event.preventDefault();
  });

  if (window.location.hash.indexOf('#project-card-') === 0) {
    var targetDetails = document.querySelector(window.location.hash);
    if (targetDetails && targetDetails.tagName === 'DETAILS') {
      targetDetails.open = true;
    }
  }

  refreshOrderState();
})();
