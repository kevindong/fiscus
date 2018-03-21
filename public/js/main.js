$(function() {
  $('#search-bar').select2({
    theme: 'bootstrap4',
    width: '100%',
    placeholder: 'Search for a stock',
    ajax: {
      url: '/ticker/lookup',
      dataType: 'json',
      data: function(params) {
        return { text: params.term };
      }
    }
  });
  $('#search-bar').on('select2:select', function(e) {
    const data = e.params.data;
    $(location).attr('href', `${window.location.origin}/ticker/details/${data.id}`)
  })
});

$(function() {
  $('#search-bar-transactions').select2({
    theme: 'bootstrap4',
    width: 'inherit',
    ajax: {
      url: '/ticker/lookup',
      dataType: 'json',
      data: function(params) {
        return { text: params.term };
      }
    }
  });
});