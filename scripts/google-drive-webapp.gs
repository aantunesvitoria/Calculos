const FOLDER_ID = "1dE6OLsDk2YXAZV3evo0wIUQqJvWTDQgK";
const UPLOAD_SECRET = "troque-esta-chave";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.secret !== UPLOAD_SECRET) {
      throw new Error("Acesso não autorizado.");
    }

    if (!data.filename || !data.content) {
      throw new Error("Arquivo inválido.");
    }

    const bytes = Utilities.base64Decode(data.content);
    const blob = Utilities.newBlob(bytes, data.mimeType || "application/pdf", data.filename);
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const file = folder.createFile(blob);

    return jsonResponse({
      ok: true,
      id: file.getId(),
      url: file.getUrl(),
      name: file.getName()
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      message: error.message
    });
  }
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
