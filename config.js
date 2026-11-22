/* Money Tracker app settings. The Client ID is public by design (it only identifies the app to Google). */
window.MT_CONFIG = {
  clientId: '365352197164-o4gdvf5t836dk7o49julo3p6k3hv21dp.apps.googleusercontent.com',
  sheetId: '1mKS4IgOV-GuRFMx7xu10OWuoK-GOTGSI_ipQJxUTBbY',
  timeZone: 'Asia/Jakarta',
  scopes: [
    'openid', 'email',
    'https://www.googleapis.com/auth/spreadsheets',   // read and write the Money Tracker sheet
    'https://www.googleapis.com/auth/drive'           // receipts folder + sharing the sheet from "People with access"
  ].join(' ')
};
