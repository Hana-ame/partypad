mergeInto(LibraryManager.library, {
  PartyPad_RegisterUnityObject: function (gameObjectNamePtr) {
    var objName = UTF8ToString(gameObjectNamePtr);
    window.__partypadUnityTarget = objName;
    if (window.PartyPadWebGLAttach) {
      window.PartyPadWebGLAttach(function (eventJson) {
        if (window.unityInstance) {
          window.unityInstance.SendMessage(objName, 'OnWebGLMessage', eventJson);
        }
      });
    }
  },
  PartyPad_SendCommand: function (jsonPtr) {
    var json = UTF8ToString(jsonPtr);
    if (window.PartyPadWebGLCommand) {
      window.PartyPadWebGLCommand(json);
    }
  }
});
