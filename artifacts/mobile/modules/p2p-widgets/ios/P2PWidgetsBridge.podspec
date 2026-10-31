Pod::Spec.new do |s|
  s.name           = 'P2PWidgetsBridge'
  s.version        = '1.0.0'
  s.summary        = 'Home-screen widget data bridge for P2P Global'
  s.description    = 'Local Expo module: stores the widget snapshot in the shared App Group and reloads WidgetKit timelines.'
  s.author         = 'P2P Global'
  s.homepage       = 'https://p2pglobal.app'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WidgetKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,swift}'
end
