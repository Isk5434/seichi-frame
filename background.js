import { compressImage, getBackground, saveBackground } from './storage.js?v=wallpaper';

export function setupBackground({ validateImage, notice }) {
  const dialog = document.querySelector('#background-dialog');
  const input = document.querySelector('#background-file');
  const feedback = document.querySelector('#background-feedback');
  const buttons = [...dialog.querySelectorAll('[data-background-choice]')];
  const presets = new Set(buttons.map(button => button.dataset.backgroundChoice));
  let imageUrl;
  let request = 0;
  let userChoseBackground = false;

  function showFeedback(message) {
    feedback.textContent = message;
    feedback.hidden = !message;
  }

  function applyBackground(choice) {
    const photo = choice instanceof Blob;
    const background = photo ? 'photo' : choice;
    const previousUrl = imageUrl;
    imageUrl = photo ? URL.createObjectURL(choice) : undefined;
    if (imageUrl) document.body.style.setProperty('--wallpaper-photo', `url("${imageUrl}")`);
    else document.body.style.removeProperty('--wallpaper-photo');
    document.body.dataset.background = background;
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.backgroundChoice === background));
    }
    if (previousUrl) URL.revokeObjectURL(previousUrl);
  }

  function chooseBackground(choice) {
    userChoseBackground = true;
    applyBackground(choice);
    dialog.close();
    void saveBackground(choice).catch(() => {
      notice('背景を変更しましたが、端末に保存できませんでした。');
    });
  }

  document.querySelector('#background-open').onclick = () => {
    request += 1;
    showFeedback(document.body.dataset.background === 'photo' ? '端末の写真を使用中' : '');
    dialog.showModal();
  };
  for (const button of buttons) {
    button.onclick = () => chooseBackground(button.dataset.backgroundChoice);
  }

  input.onchange = async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    const selection = ++request;
    showFeedback('写真を読み込み中…');
    try {
      await validateImage(file);
      const photo = await compressImage(file);
      if (selection === request && dialog.open) chooseBackground(photo);
    } catch (error) {
      if (selection === request && dialog.open) showFeedback(error.message);
    }
  };

  void getBackground().then(choice => {
    if (!userChoseBackground && (presets.has(choice) || choice instanceof Blob)) applyBackground(choice);
  }).catch(() => {
    // The default background is available when browser storage is unavailable.
  });
}
