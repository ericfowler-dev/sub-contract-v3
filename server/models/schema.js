// Default database structure
function getDefaultDb() {
  return {
    transactions: [],
    jobsiteMapping: {
      "200748": "PDX133/170/179/180",
      "200834": "STACK SVY",
      "200841": "IAD165",
      "200847": "CMH082",
      "200874": "OSU067-071 (Multiple)",
      "200875": "CMH071",
      "200895": "LCK062",
      "200899": "DCA064",
      "200920": "CMH094",
      "200954": "IAD167",
      "200984": "STACK SVY",
      "201002": "CMH080",
      "201033": "PHL105",
      "201036": "JAN103",
      "201049": "STACK SVY",
      "201064": "IAD550",
      "201080": "IAD450",
      "201090": "PDX202",
      "201106": "LCK064",
      "201115": "PDX141",
      "201119": "PHL104",
      "201122": "PDX245-247 (Multiple)",
      "201131": "SBN201",
      "201132": "PDX245",
      "201137": "PHL105",
      "201141": "IAD168",
      "201146": "JAN200/203 (Review)",
      "201199": "JAN203",
      "201300": "IAD168",
      "201312": "IAD168",
      "201328": "PDX202",
      "201352": "JAN200"
    },
    projections: [],
    metadata: {
      lastUpload: null,
      totalRows: 0,
      uploadHistory: []
    }
  };
}

module.exports = { getDefaultDb };
