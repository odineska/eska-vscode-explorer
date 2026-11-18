const checkboxList = '<path d="M8 5h5M8 11h5"/>';
const document = '<path d="M3 2h7l3 3v9H3zM10 2v3h3"/>';

export const webStandardPictures = {
  CheckAll: checkboxList + '<path d="m2.5 4.5 1.4 1.4 2.3-2.3m-3.7 7 1.4 1.4 2.3-2.3" stroke="#168078"/>',
  UncheckAll: checkboxList + '<rect x="2.5" y="3.5" width="3" height="3" rx=".4"/><rect x="2.5" y="9.5" width="3" height="3" rx=".4"/>',
  DeleteListItemDirectly: '<path d="M2 4h5M2 8h5M2 12h5"/><path d="m9 6 4.5 4.5m0-4.5L9 10.5" stroke="#ab453f" stroke-width="2"/>',
  EventLog: '<path d="M7 3.5h6m-6 4.5h6m-6 4.5h6"/><path d="M3 3.5h.1M3 8h.1M3 12.5h.1" stroke="#276aa0" stroke-width="2"/>',
  ExchangePlan: '<path d="M2 5h11l-2.5-2.5M14 11H3l2.5 2.5" stroke="#168078" stroke-width="2"/>',
  MoveLeft: '<path d="M13 8H3m4-4L3 8l4 4" stroke="#276aa0" stroke-width="2"/>',
  OpenFile: '<path d="M2 12V4h4l1.5 1.5H13V8M2 12l2-4h10l-2 4z" stroke="#276aa0"/>',
  Post: document + '<path d="m5 9 2 2 4-4" stroke="#168078"/>',
  Refresh: '<path d="M12.5 5A5.5 5.5 0 1 0 13 10M13 2v4h-4" stroke="#168078" stroke-width="1.8"/>',
};
