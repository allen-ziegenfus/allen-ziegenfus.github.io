import React from "react";
import PropTypes from "prop-types";

import Row from "./Row";
import LinkOrAnchor from "./LinkOrAnchor";
import Header from "./Header";
import getFieldsToDisplay from "../utils/getFieldsToDisplay";

const RowPage = ({ rowData }) => (
  <div className="row-page">
    {process.env.HEADER_TITLE && process.env.HEADER_TITLE && (
      <Header title={process.env.HEADER_TITLE} />
    )}
    <LinkOrAnchor className="nav-button" to="/">
      Zurück
    </LinkOrAnchor>

    <Row
      fieldsToDisplay={getFieldsToDisplay(process.env.TITLE_FIELD)}
      rowData={rowData}
    />

    <div class="row-container">
      <div class="row-container-left">
        <Row
          fieldsToDisplay={getFieldsToDisplay(process.env.FIELD_ORDER)}
          rowData={rowData}
        />
      </div>
      <div class="row-container-right">
        <Row
          fieldsToDisplay={getFieldsToDisplay(process.env.IMAGE_FIELD)}
          rowData={rowData}
        />
      </div>
    </div>
    <LinkOrAnchor className="nav-button" to="/">
      Zurück
    </LinkOrAnchor>
  </div>
);

RowPage.propTypes = {
  rowData: PropTypes.shape({
    fields: PropTypes.arrayOf(
      PropTypes.shape({
        name: PropTypes.string.isRequired
      })
    )
  }).isRequired
};
export default RowPage;
