"use strict";
/* globals app, config, define, socket, translator, templates, utils, ajaxify */

define('chat', ['taskbar', 'string', 'sounds', 'forum/chats'], function(taskbar, S, sounds, Chats) {

	var module = {};
	var newMessage = false;

	module.prepareDOM = function() {
		// Chats Dropdown
		var	chatsToggleEl = $('#chat_dropdown'),
			chatsListEl = $('#chat-list');

		chatsToggleEl.on('click', function() {
			if (chatsToggleEl.parent().hasClass('open')) {
				return;
			}

			socket.emit('modules.chats.list', function(err, chats) {
				if (err) {
					return app.alertError(err.message);
				}

				var	userObj;

				chatsListEl.empty();

				if (!chats.length) {
					translator.translate('[[modules:chat.no_active]]', function(str) {
						$('<li />')
							.addClass('no_active')
							.html('<a href="#">' + str + '</a>')
							.appendTo(chatsListEl);
					});
					return;
				}

				for(var x = 0; x<chats.length; ++x) {
					userObj = chats[x];
					$('<li class="' + (userObj.unread ? 'unread' : '') + '"/>')
						.attr('data-uid', userObj.uid)
						.html('<a href="javascript:app.openChat(\'' +
							userObj.username +
							'\', ' + userObj.uid +
							');">'+
							'<img src="' +	userObj.picture + '" title="' +	userObj.username +'" />' +
							'<i class="fa fa-circle status ' + userObj.status + '"></i> ' +
							userObj.username + '</a>')
						.appendTo(chatsListEl);
				}

				var seeAll = '<li class="pagelink"><a href="' + config.relative_path + '/chats">[[modules:chat.see_all]]</a></li>';
				translator.translate(seeAll, function(translated) {
					$(translated).appendTo(chatsListEl);
				});
			});
		});

		socket.on('event:chats.receive', function(data) {
			if (ajaxify.currentPage.slice(0, 6) === 'chats/') {
				// User is on the chats page, so do nothing (src/forum/chats.js will handle it)
				return;
			}

			var username = data.message.fromUser.username;
			var isSelf = parseInt(data.message.fromUser.uid, 10) === parseInt(app.uid, 10);
			if (isSelf) {
				username = data.message.toUser.username;
			}
			newMessage = data.message.self === 0;
			if (module.modalExists(data.withUid)) {
				var modal = module.getModal(data.withUid);
				module.appendChatMessage(modal, data.message);

				if (modal.is(":visible")) {
					module.bringModalToTop(modal);
					checkOnlineStatus(modal);
					taskbar.updateActive(modal.attr('UUID'));
					Chats.scrollToBottom(modal.find('#chat-content'));
				} else {
					module.toggleNew(modal.attr('UUID'), true);
				}

				if (!isSelf && (!modal.is(":visible") || !app.isFocused)) {
					app.alternatingTitle('[[modules:chat.user_has_messaged_you, ' + username + ']]');
					sounds.play('chat-incoming');
				}
			} else {
				module.createModal(username, data.withUid, function(modal) {
					module.toggleNew(modal.attr('UUID'), true);
					if (!isSelf) {
						app.alternatingTitle('[[modules:chat.user_has_messaged_you, ' + username + ']]');
						sounds.play('chat-incoming');
					}
				});
			}
		});

		socket.on('event:chats.userStartTyping', function(withUid) {
			var modal = module.getModal(withUid);
			var chatContent = modal.find('#chat-content');
			if (!chatContent.length) {
				return;
			}
			var atBottom = chatContent[0].scrollHeight - chatContent.scrollTop() === chatContent.innerHeight();

			modal.find('.user-typing').removeClass('hide');
			if (atBottom) {
				Chats.scrollToBottom(chatContent);
			}
		});

		socket.on('event:chats.userStopTyping', function(withUid) {
			var modal = module.getModal(withUid);
			modal.find('.user-typing').addClass('hide');
		});
	};

	module.bringModalToTop = function(chatModal) {
		var topZ = 0;
		$('.chat-modal').each(function() {
			var thisZ = parseInt($(this).css('zIndex'), 10);
			if (thisZ > topZ) {
				topZ = thisZ;
			}
		});
		chatModal.css('zIndex', topZ + 1);
	};

	module.getModal = function(touid) {
		return $('#chat-modal-' + touid);
	};

	module.modalExists = function(touid) {
		return $('#chat-modal-' + touid).length !== 0;
	};

	function checkStatus(chatModal) {
		socket.emit('user.isOnline', chatModal.attr('touid'), function(err, data) {
			translator.translate('[[global:' + data.status + ']]', function(translated) {
				$('#chat-user-status').attr('class', 'fa fa-circle status ' + data.status)
					.attr('title', translated)
					.attr('data-original-title', translated);
			});
		});
	}

	function checkOnlineStatus(chatModal) {
		if(parseInt(chatModal.attr('intervalId'), 10) === 0) {
			chatModal.attr('intervalId', setInterval(function() {
				checkStatus(chatModal);
			}, 1000));
		}
	}

	module.createModal = function(username, touid, callback) {

		templates.parse('chat', {}, function(chatTpl) {
			translator.translate(chatTpl, function (chatTpl) {

				var chatModal = $(chatTpl),
					uuid = utils.generateUUID();

				chatModal.attr('id', 'chat-modal-' + touid);
				chatModal.attr('touid', touid);
				chatModal.attr('intervalId', 0);
				chatModal.attr('UUID', uuid);
				chatModal.css("position", "fixed");
				chatModal.appendTo($('body'));
				chatModal.draggable({
					start:function() {
						module.bringModalToTop(chatModal);
					},
					stop:function() {
						chatModal.find('#chat-message-input').focus();
					},
					distance: 10,
					handle: '.modal-header'
				});

				chatModal.find('.modal-content').resizable({
					minHeight: 250,
					minWidth: 400
				});

				chatModal.find('.modal-content').on('resize', function(event, ui) {
					if (ui.originalSize.height === ui.size.height) {
						return;
					}
					var totalHeight = chatModal.find('.modal-content').outerHeight() - chatModal.find('.modal-header').outerHeight();
					var padding = parseInt(chatModal.find('.modal-body').css('padding-top'), 10) + parseInt(chatModal.find('.modal-body').css('padding-bottom'), 10);
					var contentMargin = parseInt(chatModal.find('#chat-content').css('margin-top'), 10) + parseInt(chatModal.find('#chat-content').css('margin-bottom'), 10);
					var inputGroupHeight = chatModal.find('.input-group').outerHeight();

					chatModal.find('#chat-content').css('height', totalHeight - padding - contentMargin - inputGroupHeight);
				});

				chatModal.find('#chat-with-name').html(username);

				chatModal.find('#chat-close-btn').on('click', function() {
					module.close(chatModal);
				});

				chatModal.find('button[data-action="maximize"]').on('click', function() {
					ajaxify.go('chats/' + utils.slugify(username));
					module.close(chatModal);
				});

				chatModal.on('click', function(e) {
					module.bringModalToTop(chatModal);
				});

				chatModal.on('mousemove keypress click', function() {
					if (newMessage) {
						socket.emit('modules.chats.markRead', touid);
						console.log('sent')
						newMessage = false;
					}
				});

				addSendHandler(chatModal);

				getChatMessages(chatModal, function() {
					checkOnlineStatus(chatModal);
				});

				chatModal.find('.user-typing .text').translateText('[[modules:chat.user_typing, ' + username + ']]');

				taskbar.push('chat', chatModal.attr('UUID'), {
					title: username,
					icon: 'fa-comment',
					state: ''
				});

				$(window).trigger('action:chat.loaded', chatModal);

				callback(chatModal);
			});
		});
	};

	module.close = function(chatModal) {
		clearInterval(chatModal.attr('intervalId'));
		chatModal.attr('intervalId', 0);
		chatModal.remove();
		chatModal.data('modal', null);
		taskbar.discard('chat', chatModal.attr('UUID'));
		Chats.notifyTyping(chatModal.attr('touid'), false);
	};

	module.center = function(chatModal) {
		chatModal.css("left", Math.max(0, (($(window).width() - $(chatModal).outerWidth()) / 2) + $(window).scrollLeft()) + "px");
		chatModal.css("top", $(window).height() / 4 - $(chatModal).outerHeight() / 2);
		chatModal.css("zIndex", 2000);
		chatModal.find('#chat-message-input').focus();
		return chatModal;
	};

	module.load = function(uuid) {
		var chatModal = $('div[UUID="'+uuid+'"]');
		chatModal.removeClass('hide');
		checkOnlineStatus(chatModal);
		taskbar.updateActive(uuid);
		Chats.scrollToBottom(chatModal.find('#chat-content'));
		module.center(chatModal);
		module.bringModalToTop(chatModal);
		socket.emit('modules.chats.markRead', chatModal.attr('touid'));
	};

	module.minimize = function(uuid) {
		var chatModal = $('div[UUID="' + uuid + '"]');
		chatModal.addClass('hide');
		taskbar.minimize('chat', uuid);
		clearInterval(chatModal.attr('intervalId'));
		chatModal.attr('intervalId', 0);
		Chats.notifyTyping(chatModal.attr('touid'), false);
	};

	function getChatMessages(chatModal, callback) {
		socket.emit('modules.chats.get', {touid: chatModal.attr('touid')}, function(err, messages) {
			module.appendChatMessage(chatModal, messages, callback);
		});
	}

	function addSendHandler(chatModal) {
		var input = chatModal.find('#chat-message-input');
		input.off('keypress').on('keypress', function(e) {
			if(e.which === 13) {
				Chats.sendMessage(chatModal.attr('touid'), chatModal.find('#chat-message-input'));
			}
		});

		input.off('keyup').on('keyup', function() {
			if ($(this).val()) {
				socket.emit('modules.chats.userStartTyping', {touid:chatModal.attr('touid'), fromUid: app.uid});
			} else {
				Chats.notifyTyping(chatModal.attr('touid'), false);
			}
		});

		chatModal.find('#chat-message-send-btn').off('click').on('click', function(e){
			Chats.sendMessage(chatModal.attr('touid'), chatModal.find('#chat-message-input'));
			return false;
		});
	}

	module.appendChatMessage = function(chatModal, data, done) {
		var chatContent = chatModal.find('#chat-content'),
			typingNotif = chatModal.find('.user-typing');

		Chats.parseMessage(data, function(html) {
			var message = $(html);
			message.find('img:not(".chat-user-image")').addClass('img-responsive');
			message.find('span.timeago').timeago();
			message.insertBefore(typingNotif);
			Chats.scrollToBottom(chatContent);

			if (typeof done === 'function') {
				done();
			}
		});
	};

	module.toggleNew = function(uuid, state) {
		taskbar.toggleNew(uuid, state);
	};

	return module;
});
